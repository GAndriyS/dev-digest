import { BYTES_PER_TOKEN_EST, SKIP_DIR_NAMES } from './constants.js';
import type { AttachedContextDoc, ContextDocSource, EnabledSkillRef, SkippedContextDoc } from './types.js';

/**
 * Deterministic size-based token estimate (see `constants.ts` for why this is
 * not a real tokenizer count). Rounds up so a non-empty file never reads as
 * "0 tokens", and floors at 1 for the same reason.
 */
export function estimateTokens(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / BYTES_PER_TOKEN_EST));
}

/**
 * The badge for a document matched by CONFIGURED NAME (SPEC-01 AC-27) rather
 * than by root — the lowercased stem (extension stripped) of the CONFIGURED
 * name that matched, never the on-disk file's own casing. `Insights.md` on
 * disk matching a configured `INSIGHTS.md` badges `insights`, derived from
 * the config entry, not from what happens to be on disk (SPEC-01 edge case
 * "Файл на диску названий `Insights.md`, а в конфізі `INSIGHTS.md`").
 */
export function nameBadgeFor(fileName: string): string {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot === -1 ? lower : lower.slice(0, dot);
}

/**
 * The badge a listed/attached path would carry — re-derives
 * `walkContextFiles`'s OWN two rules rather than a looser "root name
 * anywhere in the path" test, so this stays a genuine bound and not just a
 * path-segment substring check (fix pass 2, item 1; the same discipline now
 * extends to the name rule, SPEC-01 AC-26).
 *
 * The walk's rules, restated purely (no filesystem access, so this can run
 * on a stored path with no clone on disk):
 *
 * 1. Root rule (SPEC-01): scan the path's DIRECTORY segments (every segment
 *    except the final file name) left to right. The first directory segment
 *    that names a configured root activates that root for every segment
 *    after it — matching `nextRoot = activeRoot ?? (rootSet.has(...) ? ... :
 *    null)` in the walk. Activating a root is NOT by itself enough for the
 *    file to qualify under this rule — the walk also requires the file name
 *    to end in `.md` (case-insensitive) once a root is active
 *    (`matchesRoot = activeRoot !== null && entry.name…endsWith('.md')`).
 *    A non-`.md` file under an active root (`specs/notes.txt`) matches
 *    NEITHER rule and must badge `null`, not the root — that gap is exactly
 *    what this function failed to mirror before this fix.
 * 2. Name rule (SPEC-01 AC-26): independent of any root, the final segment
 *    (the file name) matched case-insensitively against a configured file
 *    name badges the file — `nameBadgeFor` of the CONFIGURED name that
 *    matched, on any depth including the clone root.
 * 3. Root wins when both apply on the same file (SPEC-01 AC-28) — one entry,
 *    never two. Because a configured file name always ends in `.md` (AC-30
 *    strips anything else at config load), a file that matches the name rule
 *    while a root is active always also satisfies rule 1's extension check,
 *    so root badges it precisely when the walk would have too.
 *
 * The walk also never DESCENDS into a `SKIP_DIR_NAMES` directory at all
 * (`if (SKIP_DIR_NAMES.has(entry.name)) continue`), checked on every
 * directory regardless of whether a root is already active or a name would
 * otherwise match — so a `SKIP_DIR_NAMES` segment anywhere among the
 * directory segments means the walk would never have reached this file
 * under EITHER rule, and this function must refuse it too, even if a
 * configured root appears earlier in the path
 * (e.g. `specs/node_modules/pkg/README.md`), or the file name would
 * otherwise match a configured name (e.g. `node_modules/INSIGHTS.md`).
 *
 * Returns `null` for a path that matches neither rule, or that passes
 * through a skipped directory — callers treat that as "no badge, not
 * readable, not attachable", not an error.
 */
export function badgeFor(
  relPath: string,
  roots: readonly string[],
  fileNames: readonly string[],
): string | null {
  const rootSet = new Set(roots);
  const nameBadgeByLowerName = new Map<string, string>();
  for (const name of fileNames) nameBadgeByLowerName.set(name.toLowerCase(), nameBadgeFor(name));

  const segments = relPath.split('/');
  const fileName = segments[segments.length - 1]!;
  let activeRoot: string | null = null;
  // Last segment is the file name — only directory segments gate root/skip.
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i]!;
    if (SKIP_DIR_NAMES.has(segment)) return null;
    if (activeRoot === null && rootSet.has(segment)) activeRoot = segment;
  }
  // Mirrors the walk's own acceptance test exactly (`service.ts`'s
  // `matchesRoot`/`nameBadge`/`badge` trio): an active root alone does not
  // qualify a non-`.md` file — `specs/notes.txt` matches neither rule.
  const matchesRoot = activeRoot !== null && fileName.toLowerCase().endsWith('.md');
  const nameBadge = nameBadgeByLowerName.get(fileName.toLowerCase()) ?? null;
  if (!matchesRoot && nameBadge === null) return null;
  return activeRoot ?? nameBadge!; // root wins when both match (AC-28)
}

/**
 * Keep the FIRST occurrence of each path, in original order. This is the
 * merge rule for "an agent's own attachments + everything inherited from its
 * enabled skills" (SPEC-01 AC-17/AC-18): the agent's own choice always wins
 * over an inherited duplicate, and the first skill in prompt order wins over
 * a later one.
 *
 * Implemented as a projection of `mergeWithAttribution` so there is exactly
 * ONE keep-first rule in the module — the repository's stored set and the
 * run's attributed merge cannot drift apart.
 */
export function dedupeKeepFirst(paths: readonly string[]): string[] {
  return mergeWithAttribution(paths, []).map((d) => d.path);
}

/**
 * Merge the agent's own paths with every enabled skill's paths, own-first
 * then skill-by-skill in `enabledSkills` order (SPEC-01 AC-17/AC-18), keeping
 * the FIRST occurrence of each path and attributing it to whichever source
 * produced that first occurrence (SPEC-01 AC-39). This is THE keep-first rule
 * of the module — `dedupeKeepFirst` is a projection of it, so the attribution
 * can never drift from the plain merge (`server/INSIGHTS.md` 2026-08-18,
 * Codebase Patterns) — a path duplicated between the agent and a skill, or
 * between two skills, is attributed to whichever source's list it appears in
 * FIRST.
 */
export function mergeWithAttribution(
  ownPaths: readonly string[],
  skillPathLists: readonly { skill: EnabledSkillRef; paths: readonly string[] }[],
): { path: string; source: ContextDocSource }[] {
  const seen = new Set<string>();
  const out: { path: string; source: ContextDocSource }[] = [];
  for (const path of ownPaths) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ path, source: { kind: 'agent' } });
  }
  for (const { skill, paths } of skillPathLists) {
    for (const path of paths) {
      if (seen.has(path)) continue;
      seen.add(path);
      out.push({
        path,
        source: { kind: 'skill', skillId: skill.id, skillName: skill.name, skillVersion: skill.version },
      });
    }
  }
  return out;
}

/**
 * The `skipped` entry for "could not load the agent's OWN attached paths"
 * (a repository read failure, not a filesystem one — SPEC-01 AC-42). Pure —
 * takes the already-caught error, does no I/O itself — so the "lookup failure
 * still names its source" invariant is unit-testable without a container
 * (`.claude/skills/onion-architecture/SKILL.md` § Testing seams).
 */
export function agentLookupFailureDoc(err: Error): SkippedContextDoc {
  return {
    path: '(agent context)',
    source: { kind: 'agent' },
    reason: `could not load the agent's attached paths — ${err.message}`,
  };
}

/**
 * The `skipped` entry for "could not load ONE enabled skill's attached
 * paths" (SPEC-01 AC-42). The skill's name+version travel in from the SAME
 * `EnabledSkillRef` the run's `Skills:` line was built from, so this line
 * names the skill even though the pseudo-path still carries only its id
 * (Recommendations §1, declined — the id stays).
 */
export function skillLookupFailureDoc(skill: EnabledSkillRef, err: Error): SkippedContextDoc {
  return {
    path: `(skill ${skill.id} context)`,
    source: { kind: 'skill', skillId: skill.id, skillName: skill.name, skillVersion: skill.version },
    reason: `could not load the skill's attached paths — ${err.message}`,
  };
}

/**
 * One document, formatted for the `specs` prompt slot. reviewer-core wraps
 * each array element with `wrapUntrusted('spec-N', …)` — it has no idea which
 * document N is, so the path is baked into the chunk itself (matches the
 * `## <file>` framing `run-executor`'s callers/repo-map digests already use).
 */
export function formatContextChunk(path: string, content: string): string {
  return `### ${path}\n\n${content}`;
}

/** Result of packing already-read documents under a character budget. */
export interface PackedContextDocs {
  specs: string[];
  attached: AttachedContextDoc[];
  skipped: SkippedContextDoc[];
}

/**
 * Pack already-read documents into the prompt block, stopping (per-document)
 * once the running total would exceed `maxChars`. A document that doesn't fit
 * is skipped, not truncated — a partial markdown doc is worse than no doc,
 * and the Live Log line + `specs_read` gap make the drop visible (Observability
 * NFR, `server/INSIGHTS.md`-precedent "never go silent").
 *
 * Pure — no I/O. The service reads file content first; this only decides
 * ordering and the budget cutoff, which is what makes it unit-testable
 * without a filesystem or a container. Each doc carries its `source` in from
 * the merge (`mergeWithAttribution`) and out again unchanged on both the
 * `attached` and `skipped` sides (SPEC-01 AC-43).
 */
export function packDocs(
  docs: readonly { path: string; content: string; source: ContextDocSource }[],
  maxChars: number,
): PackedContextDocs {
  const specs: string[] = [];
  const attached: AttachedContextDoc[] = [];
  const skipped: SkippedContextDoc[] = [];
  let total = 0;
  for (const { path, content, source } of docs) {
    const chunk = formatContextChunk(path, content);
    if (total + chunk.length > maxChars) {
      skipped.push({ path, source, reason: `exceeds the ${maxChars}-character project context budget` });
      continue;
    }
    specs.push(chunk);
    attached.push({ path, source });
    total += chunk.length;
  }
  return { specs, attached, skipped };
}
