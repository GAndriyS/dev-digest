import { describe, it, expect, vi } from 'vitest';
import { BlastService } from '../src/modules/blast/service.js';
import { NotFoundError } from '../src/platform/errors.js';
import type { BlastResult, IndexState } from '../src/modules/repo-intel/types.js';

/**
 * L04 — BlastService shaping and status semantics.
 *
 * No Postgres and no LLM: the container is a fake whose `repoIntel` returns
 * canned `BlastResult`s, so these pin the two things the UI and the MCP tool
 * both depend on — how callers group under their changed symbol, and how a
 * thin index is reported instead of being flattened into an empty map.
 */

const PULL = { id: 'pr1', repoId: 'repo1', number: 8, title: 't', body: null } as never;

function indexState(status: IndexState['status']): IndexState {
  return {
    status,
    lastIndexedSha: 'abc',
    indexerVersion: 2,
    filesIndexed: 10,
    filesSkipped: 0,
    updatedAt: new Date(0),
  } as IndexState;
}

function buildService(opts: {
  blast: BlastResult;
  status?: IndexState['status'];
  pull?: unknown;
  files?: Array<{ path: string; additions: number; deletions: number }>;
  llm?: { complete: ReturnType<typeof vi.fn> };
  settingsRows?: unknown[];
}) {
  // `completeStructured`, not `complete` — the default provider (OpenRouter)
  // implements only the structured path, which is why the service uses it.
  const complete =
    opts.llm?.complete ??
    vi.fn(async () => ({
      data: { summary: '  A paragraph about the map.  ' },
      model: 'deepseek/deepseek-v4-flash',
      tokensIn: 100,
      tokensOut: 20,
      costUsd: 0.0001,
      raw: '{}',
      attempts: 1,
    }));

  const container = {
    reviewRepo: {
      getPull: async () => (opts.pull === undefined ? PULL : opts.pull),
      getPrFiles: async () => opts.files ?? [{ path: 'src/a.ts', additions: 1, deletions: 0 }],
    },
    repoIntel: {
      getBlastRadius: async () => opts.blast,
      getIndexState: async () => indexState(opts.status ?? 'full'),
    },
    llm: async () => ({ completeStructured: complete }),
    // `resolveFeatureModel` reads settings straight off the db handle.
    db: {
      select: () => ({ from: () => ({ where: async () => opts.settingsRows ?? [] }) }),
    },
  } as never;

  return { service: new BlastService(container), complete };
}

const FULL_BLAST: BlastResult = {
  changedSymbols: [
    { file: 'src/a.ts', name: 'rateLimit', kind: 'function' },
    { file: 'src/a.ts', name: 'bucketKey', kind: 'function' },
  ],
  callers: [
    { file: 'src/api/public/index.ts', symbol: 'publicRouter', viaSymbol: 'rateLimit', line: 23, rank: 0.9 },
    { file: 'src/server.ts', symbol: 'buildServer', viaSymbol: 'rateLimit', line: 88, rank: 0.7 },
    { file: 'src/api/public/webhooks.ts', symbol: 'webhooks', viaSymbol: 'bucketKey', line: 45, rank: 0.4 },
  ],
  impactedEndpoints: ['GET /api/public/items'],
  factsByFile: {
    'src/api/public/index.ts': { endpoints: ['GET /api/public/items'], crons: [] },
    'src/api/public/webhooks.ts': { endpoints: ['POST /api/public/webhooks'], crons: [] },
    'src/jobs/reset.ts': { endpoints: [], crons: ['reset-rate-buckets (hourly)'] },
  },
  dependentClosure: {
    'src/a.ts': { level1: ['src/api/public/index.ts'], level2: ['src/jobs/reset.ts'] },
  },
  degraded: false,
};

describe('BlastService.getBlast — shaping', () => {
  it('groups callers under the changed symbol they reach', async () => {
    const { service } = buildService({ blast: FULL_BLAST });
    const out = await service.getBlast('ws1', 'pr1');

    expect(out.changed_symbols.map((s) => s.name)).toEqual(['rateLimit', 'bucketKey']);
    // Widest reach first.
    expect(out.downstream[0]?.symbol).toBe('rateLimit');
    expect(out.downstream[0]?.callers.map((c) => c.name)).toEqual(['publicRouter', 'buildServer']);
    expect(out.downstream[1]?.callers.map((c) => c.file)).toEqual(['src/api/public/webhooks.ts']);
    expect(out.downstream[0]?.callers[0]?.rank).toBe(0.9);
  });

  it('attributes endpoints and crons through the dependent closure', async () => {
    const { service } = buildService({ blast: FULL_BLAST });
    const out = await service.getBlast('ws1', 'pr1');
    const rateLimit = out.downstream.find((d) => d.symbol === 'rateLimit');

    // From its caller's file (level-0 evidence)...
    expect(rateLimit?.endpoints_affected).toContain('GET /api/public/items');
    // ...and from a file two import hops away that never names the symbol.
    expect(rateLimit?.crons_affected).toContain('reset-rate-buckets (hourly)');
  });

  it('lists a changed symbol nothing calls instead of dropping it', async () => {
    const { service } = buildService({
      blast: { ...FULL_BLAST, callers: [], dependentClosure: {}, factsByFile: {} },
    });
    const out = await service.getBlast('ws1', 'pr1');

    expect(out.downstream).toHaveLength(2);
    expect(out.downstream.every((d) => d.callers.length === 0)).toBe(true);
  });

  it('summary counts are deterministic, not model-written', async () => {
    const { service, complete } = buildService({ blast: FULL_BLAST });
    const out = await service.getBlast('ws1', 'pr1');

    expect(out.summary).toBe(
      '2 changed symbol(s); 3 caller(s) across 3 file(s); 2 endpoint(s), 1 cron(s) affected.',
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it('reports the commit its line numbers resolve against', async () => {
    const { service } = buildService({ blast: FULL_BLAST });
    const out = await service.getBlast('ws1', 'pr1');

    // The index's commit, not the PR head — a caller linking to head would
    // land on whatever happens to sit at that line there.
    expect(out.indexed_sha).toBe('abc');
  });

  it('404s for a PR outside the workspace', async () => {
    const { service } = buildService({ blast: FULL_BLAST, pull: null });
    await expect(service.getBlast('ws1', 'nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('BlastService.getBlast — index status is never masked', () => {
  it('full index → status full, no reason', async () => {
    const { service } = buildService({ blast: FULL_BLAST, status: 'full' });
    const out = await service.getBlast('ws1', 'pr1');
    expect(out.status).toBe('full');
    expect(out.reason).toBeUndefined();
  });

  it('partial index still renders data, flagged partial', async () => {
    const { service } = buildService({ blast: FULL_BLAST, status: 'partial' });
    const out = await service.getBlast('ws1', 'pr1');
    expect(out.status).toBe('partial');
    expect(out.downstream.length).toBeGreaterThan(0);
  });

  it('degraded facade → status degraded with the reason, not an empty map', async () => {
    const { service } = buildService({
      blast: {
        changedSymbols: [],
        callers: [],
        impactedEndpoints: [],
        degraded: true,
        reason: 'index_failed',
      },
    });
    const out = await service.getBlast('ws1', 'pr1');

    expect(out.status).toBe('degraded');
    expect(out.reason).toBe('index_failed');
  });

  it('blames the missing file list, not the index, when no changed files are recorded', async () => {
    const { service } = buildService({ blast: FULL_BLAST, files: [] });
    const out = await service.getBlast('ws1', 'pr1');

    // The index may be perfectly healthy here — `no_data` would send the
    // reader off to re-index for nothing.
    expect(out.status).toBe('degraded');
    expect(out.reason).toBe('no_changed_files');
  });

  it('degraded without an explicit reason still names one', async () => {
    const { service } = buildService({
      blast: { changedSymbols: [], callers: [], impactedEndpoints: [], degraded: true },
    });
    const out = await service.getBlast('ws1', 'pr1');
    expect(out.reason).toBe('no_data');
  });
});

describe('BlastService.getBlastSummary — exactly one model call', () => {
  it('calls the LLM once and returns the trimmed paragraph', async () => {
    const { service, complete } = buildService({ blast: FULL_BLAST });
    const out = await service.getBlastSummary('ws1', 'pr1');

    expect(complete).toHaveBeenCalledTimes(1);
    expect(out.summary).toBe('A paragraph about the map.');
  });

  it('sends the computed map as untrusted data, not as instructions', async () => {
    const { service, complete } = buildService({ blast: FULL_BLAST });
    await service.getBlastSummary('ws1', 'pr1');

    const req = complete.mock.calls[0]?.[0] as { messages: Array<{ content: string }> };
    const user = req.messages[1]?.content ?? '';
    expect(user).toContain('<untrusted');
    expect(user).toContain('rateLimit');
    // The model narrates the map — it is never asked to discover impact itself.
    expect(req.messages[0]?.content).toContain('never invent a caller');
  });
});
