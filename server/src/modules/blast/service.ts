import type { Container } from '../../platform/container.js';
import type { BlastRadius, BlastCaller, DownstreamImpact } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { assemblePrompt } from '../../platform/prompt.js';
import type { RunLogger } from '../../platform/run-logger.js';
import type { BlastResult } from '../repo-intel/types.js';
import { resolveFeatureModel } from '../settings/index.js';
import type { Blast } from './types.js';
import {
  BLAST_SUMMARY_MAX_RETRIES,
  BLAST_SUMMARY_MAX_TOKENS,
  BLAST_SUMMARY_SYSTEM_PROMPT,
  BlastSummaryOutput,
} from './constants.js';

/**
 * Blast Radius (L04) — "what else can this diff touch?".
 *
 * Reads the repo-intel index and nothing else: symbols declared in the PR's
 * changed files, the callers that resolve to them, and the endpoints/crons
 * reachable through the reverse import graph. No AST parsing, no clone walk
 * and no LLM call on this path — `container.repoIntel` serves it all from
 * Postgres, so the endpoint stays cheap enough to open on every PR.
 *
 * Data access goes through `container.repoIntel` (the port, typed from
 * `repo-intel/types.js`) and `container.reviewRepo` (the sanctioned
 * cross-module seam), so this module owns no SQL of its own — `file_edges`,
 * `file_facts` and `symbols` belong to repo-intel and stay there.
 */
export class BlastService implements Blast {
  private repo: Container['reviewRepo'];

  constructor(private container: Container) {
    this.repo = container.reviewRepo;
  }

  /**
   * `getPull` is the only tenancy gate — `pr_files` carries no `workspace_id`
   * of its own, so scoping happens through the PR row (same rule as
   * smart-diff).
   *
   * Never returns a bare empty map for missing data: `status` says whether the
   * index actually backed the answer, so "nothing depends on this" and "the
   * index could not tell" stay distinguishable to the reader.
   */
  async getBlast(workspaceId: string, prId: string): Promise<BlastRadius> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.repo.getPrFiles(prId);
    const changedFiles = files.map((f) => f.path);

    // No changed files recorded yet (`pr_files` is refreshed by `GET /pulls/:id`,
    // not by this route). The index may be perfectly healthy, so blaming it —
    // the facade's `no_data` — would send the reader off to re-index for
    // nothing. Name the actual gap instead.
    if (changedFiles.length === 0) {
      return {
        changed_symbols: [],
        downstream: [],
        summary: summarize({ changedSymbols: [], callers: [], impactedEndpoints: [] }, []),
        status: 'degraded',
        reason: 'no_changed_files',
        indexed_sha: null,
      };
    }

    const [blast, indexState] = await Promise.all([
      this.container.repoIntel.getBlastRadius(pull.repoId, changedFiles),
      this.container.repoIntel.getIndexState(pull.repoId),
    ]);

    const status: BlastRadius['status'] = blast.degraded
      ? 'degraded'
      : indexState.status === 'partial'
        ? 'partial'
        : 'full';

    const downstream = this.toDownstream(blast);
    return {
      changed_symbols: blast.changedSymbols.map((s) => ({
        name: s.name,
        file: s.file,
        kind: s.kind,
      })),
      downstream,
      summary: summarize(blast, downstream),
      status,
      ...(blast.degraded ? { reason: blast.reason ?? 'no_data' } : {}),
      // Line numbers come from the index, so the commit it was built at is
      // what resolves them — the PR's head usually is NOT that commit.
      indexed_sha: indexState.lastIndexedSha || null,
    };
  }

  /**
   * The one optional model call in this feature, and never on `GET`: the map is
   * already computed deterministically and handed to the model as the only
   * content, so the paragraph narrates the index rather than guessing at it.
   * Not persisted — regenerate on demand.
   */
  async getBlastSummary(
    workspaceId: string,
    prId: string,
    log?: RunLogger,
  ): Promise<{ summary: string }> {
    const blast = await this.getBlast(workspaceId, prId);
    const { provider, model } = await resolveFeatureModel(
      this.container,
      workspaceId,
      'blast_summary',
    );
    const llm = await this.container.llm(provider);

    // The map is derived from repo code, so it rides in the `diff` slot —
    // delimiter-wrapped as untrusted like every other repo-derived input.
    const { messages } = assemblePrompt({
      system: BLAST_SUMMARY_SYSTEM_PROMPT,
      diff: `Precomputed blast radius map (JSON, index-derived facts):\n${JSON.stringify(
        { ...blast, summary: undefined },
        null,
        2,
      )}`,
      task: `Explain the blast radius of this change. Index status: ${blast.status}${
        blast.reason ? ` (${blast.reason})` : ''
      }. Deterministic counts: ${blast.summary}`,
    });

    // Structured, not plain `complete()`: the default provider (OpenRouter)
    // implements only `completeStructured` — see `BlastSummaryOutput`'s note.
    const res = await llm.completeStructured<BlastSummaryOutput>({
      model,
      schema: BlastSummaryOutput,
      schemaName: 'BlastSummary',
      messages,
      maxTokens: BLAST_SUMMARY_MAX_TOKENS,
      maxRetries: BLAST_SUMMARY_MAX_RETRIES,
    });
    log?.result(`Blast summary: ${res.tokensIn} in / ${res.tokensOut} out via ${res.model}`);
    return { summary: res.data.summary.trim() };
  }

  /**
   * Group callers by the changed symbol they reach. Callers arrive already
   * rank-sorted and capped per symbol by the facade.
   *
   * Endpoints/crons for a symbol are the union of the facts of (a) the files
   * its callers live in and (b) the reverse-import closure of its declaring
   * file — that second half is what catches an endpoint that never names the
   * symbol and only mounts a module which does.
   */
  private toDownstream(blast: BlastResult): DownstreamImpact[] {
    const facts = blast.factsByFile ?? {};
    const closure = blast.dependentClosure ?? {};

    const bySymbol = new Map<string, { callers: BlastCaller[]; files: Set<string> }>();
    // Every changed symbol gets an entry, so a symbol nothing calls is stated
    // rather than dropped silently.
    for (const s of blast.changedSymbols) {
      const entry = bySymbol.get(s.name) ?? { callers: [], files: new Set<string>() };
      for (const f of closure[s.file]?.level1 ?? []) entry.files.add(f);
      for (const f of closure[s.file]?.level2 ?? []) entry.files.add(f);
      bySymbol.set(s.name, entry);
    }
    for (const c of blast.callers) {
      const entry = bySymbol.get(c.viaSymbol) ?? { callers: [], files: new Set<string>() };
      entry.callers.push({ name: c.symbol, file: c.file, line: c.line, rank: c.rank });
      entry.files.add(c.file);
      bySymbol.set(c.viaSymbol, entry);
    }

    const out: DownstreamImpact[] = [];
    for (const [symbol, entry] of bySymbol) {
      const endpoints = new Set<string>();
      const crons = new Set<string>();
      for (const file of entry.files) {
        for (const e of facts[file]?.endpoints ?? []) endpoints.add(e);
        for (const c of facts[file]?.crons ?? []) crons.add(c);
      }
      out.push({
        symbol,
        callers: entry.callers,
        endpoints_affected: [...endpoints].sort(),
        crons_affected: [...crons].sort(),
      });
    }

    // Widest reach first — that is the order a reviewer reads in.
    out.sort((a, b) => b.callers.length - a.callers.length || a.symbol.localeCompare(b.symbol));
    return out;
  }
}

/** Deterministic counts sentence. Never model-written — see `getBlastSummary`. */
function summarize(blast: BlastResult, downstream: DownstreamImpact[]): string {
  const callerFiles = new Set(blast.callers.map((c) => c.file));
  const endpoints = new Set(downstream.flatMap((d) => d.endpoints_affected));
  const crons = new Set(downstream.flatMap((d) => d.crons_affected));
  return (
    `${blast.changedSymbols.length} changed symbol(s); ` +
    `${blast.callers.length} caller(s) across ${callerFiles.size} file(s); ` +
    `${endpoints.size} endpoint(s), ${crons.size} cron(s) affected.`
  );
}
