import 'dotenv/config';
import { z } from 'zod';
import { homedir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';

/**
 * Central, zod-validated environment config. Loaded once at startup.
 *
 * NOTE: secret keys (OPENAI/ANTHROPIC/OPENROUTER/GITHUB_TOKEN) are deliberately
 * NOT in this schema. Feature code must access secrets through SecretsProvider,
 * never via process.env or AppConfig — the SecretsProvider is the one chokepoint
 * that reads process.env directly (see adapters/secrets/local.ts). Listing them
 * here would be dead config that never reaches AppConfig.
 */
const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .default('postgres://devdigest:devdigest@localhost:5432/devdigest'),
  // Memory/RAG embeddings run on OpenAI (text-embedding-3-small, 1536-dim — the
  // pgvector columns are locked to that). Default OFF so the app makes ZERO
  // OpenAI requests; set EMBEDDINGS_ENABLED=true to turn memory retrieval on.
  EMBEDDINGS_ENABLED: z.string().optional(),
  // repo-intel facade (Tier 1). Default ON — reviews get repo skeleton +
  // callers context. Set REPO_INTEL_ENABLED=false to opt out, in which case
  // every consumer degrades to ripgrep-identical behavior (acceptance #10).
  // Note: even when on, sections only populate once the repo is indexed; an
  // unindexed repo degrades gracefully. Per-agent override: agents.repo_intel.
  REPO_INTEL_ENABLED: z.string().optional(),
  API_PORT: z.coerce.number().int().default(3001),
  WEB_PORT: z.coerce.number().int().default(3000),
  DEVDIGEST_CLONE_DIR: z.string().optional(),
  // Project Context (L05): comma-separated directory names the listing/scan
  // walk descends into anywhere in a clone's tree (e.g. "specs,docs,insights").
  // Empty/unset falls back to the spec's default triplet below.
  PROJECT_CONTEXT_ROOTS: z.string().optional(),
  // Project Context — SPEC-02: comma-separated document FILE NAMES (not
  // directories) matched anywhere in a clone's tree, on any depth including
  // the clone root (e.g. "INSIGHTS.md"). Empty/unset falls back to the
  // default below. An entry that doesn't end in `.md` or contains a path
  // separator (`/` or `\`) is dropped (AC-5) rather than rejected — one bad
  // entry must not take down every other configured name.
  PROJECT_CONTEXT_FILES: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // `.env` (and .env.example) ship `LOG_LEVEL=` empty; an empty string is not a
  // valid enum member, so coerce '' → undefined to fall through to the default.
  LOG_LEVEL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  ),
});

export type AppConfig = {
  databaseUrl: string;
  apiPort: number;
  webPort: number;
  /** Absolute path where repos are cloned (~/.devdigest/workspace by default). */
  cloneDir: string;
  /** Absolute path to the writable secrets store (BYO keys from the UI). */
  secretsPath: string;
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: string;
  /** Allowed CORS origin for the Next.js dev server. */
  webOrigin: string;
  /** Whether memory/RAG embeddings (OpenAI) are enabled. Default false. */
  embeddingsEnabled: boolean;
  /**
   * Whether the repo-intel facade (Tier 1: phantom-gate, callers-in-prompt) is
   * active. Default ON — set REPO_INTEL_ENABLED=false to opt out, in which case
   * every facade method returns its degraded result (`[]`) so consumers behave
   * EXACTLY like the ripgrep-only baseline.
   */
  repoIntelEnabled: boolean;
  /**
   * Directory names (not paths) the Project Context walk enters anywhere in a
   * clone's tree — `specs/foo.md` and `packages/x/docs/bar.md` both match.
   * Default mirrors SPEC-01's Open questions default (`specs,docs,insights`).
   */
  contextRoots: string[];
  /**
   * Document file NAMES (not directories) the Project Context walk collects
   * anywhere in a clone's tree, on any depth including the clone root —
   * `INSIGHTS.md` and `packages/x/INSIGHTS.md` both match, matched
   * case-insensitively against the file's on-disk name. A file that matches
   * both a configured root AND a configured name is listed once, badged by
   * the root (SPEC-02 AC-3). Default is `['INSIGHTS.md']` (SPEC-02 AC-4).
   */
  contextFiles: string[];
  /**
   * Entries `PROJECT_CONTEXT_FILES` supplied that AC-5 dropped (not a bare
   * `.md` name, or containing a path separator) — surfaced so a boot-time
   * warning can report a typo instead of silently landing on `contextFiles`'
   * default. Empty when every supplied entry survived, including when the
   * variable itself is unset (nothing to drop).
   */
  contextFilesDropped: string[];
};

/** Mirrors SPEC-01's Open-questions default when `PROJECT_CONTEXT_ROOTS` is unset. */
const DEFAULT_CONTEXT_ROOTS = ['specs', 'docs', 'insights'];

/** SPEC-02 AC-4's default when `PROJECT_CONTEXT_FILES` is unset or empty. */
const DEFAULT_CONTEXT_FILES = ['INSIGHTS.md'];

/**
 * AC-5: an entry survives only if it ends in `.md` (case-insensitive) and
 * carries no path separator — either slash counts, since a path (not a bare
 * file name) is what `ContextDocPath` already forbids on the wire
 * (`platform.ts`'s `.refine((p) => !p.includes('\\'), …)` and the leading-`/`
 * check share the same "no separators" intent for a single path segment).
 */
function isValidContextFileEntry(entry: string): boolean {
  return entry.toLowerCase().endsWith('.md') && !entry.includes('/') && !entry.includes('\\');
}

/**
 * Case-insensitive de-dupe, keeping the FIRST occurrence's casing — two
 * config entries differing only by case (`INSIGHTS.md,insights.md`) must
 * produce exactly one badge, not two (see plan Risks: "Дедуплікація в
 * конфізі").
 */
function dedupeCaseInsensitive(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  const cloneDirRaw =
    parsed.DEVDIGEST_CLONE_DIR ?? join(homedir(), '.devdigest', 'workspace');
  const cloneDir = isAbsolute(cloneDirRaw) ? cloneDirRaw : resolve(process.cwd(), cloneDirRaw);
  const contextRoots = parsed.PROJECT_CONTEXT_ROOTS
    ? parsed.PROJECT_CONTEXT_ROOTS.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_CONTEXT_ROOTS;
  const contextFilesEntries = parsed.PROJECT_CONTEXT_FILES
    ? parsed.PROJECT_CONTEXT_FILES.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const contextFilesDropped = contextFilesEntries.filter((e) => !isValidContextFileEntry(e));
  const contextFilesRaw = parsed.PROJECT_CONTEXT_FILES
    ? contextFilesEntries.filter(isValidContextFileEntry)
    : DEFAULT_CONTEXT_FILES;
  const contextFiles = dedupeCaseInsensitive(
    contextFilesRaw.length > 0 ? contextFilesRaw : DEFAULT_CONTEXT_FILES,
  );
  return {
    databaseUrl: parsed.DATABASE_URL,
    apiPort: parsed.API_PORT,
    webPort: parsed.WEB_PORT,
    cloneDir,
    secretsPath: join(homedir(), '.devdigest', 'secrets.json'),
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL ?? (parsed.NODE_ENV === 'test' ? 'silent' : 'info'),
    webOrigin: `http://localhost:${parsed.WEB_PORT}`,
    embeddingsEnabled: parsed.EMBEDDINGS_ENABLED === 'true',
    repoIntelEnabled: parsed.REPO_INTEL_ENABLED !== 'false',
    contextRoots: contextRoots.length > 0 ? contextRoots : DEFAULT_CONTEXT_ROOTS,
    contextFiles,
    contextFilesDropped,
  };
}
