/**
 * Constants for the skills module (L02 — Skills Lab).
 *
 * `constants.ts` is the module's published surface: it is one of the few files
 * another module is allowed to import (see `.dependency-cruiser.cjs`).
 */

/** Version a freshly-created skill starts at. */
export const INITIAL_SKILL_VERSION = 1;

/** Window (days) for the "recent activity" numbers on the skill dashboard. */
export const STATS_WINDOW_DAYS = 30;

/**
 * Eval runs always send the WHOLE case diff in ONE call. An eval case is a
 * handful of lines by construction, and map-reduce would make the result depend
 * on how the fixture happens to be split across files — noise in a measurement.
 */
export const EVAL_STRATEGY = 'single-pass' as const;

/**
 * Provider/model used when the skill is linked to no agent we can borrow from
 * (a brand-new skill in an empty workspace). Mirrors the seed defaults so a
 * fresh install evaluates on the same model its agents review with.
 */
export const EVAL_FALLBACK_PROVIDER = 'openrouter' as const;
export const EVAL_FALLBACK_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Error code returned (409) when no provider key is configured, so the UI can
 * disable its Run buttons instead of offering an action that cannot succeed.
 */
export { NO_PROVIDER_KEY_CODE } from '../../platform/errors.js';

// ---- Skill import (L02) ---------------------------------------------------

/**
 * Limits for `POST /skills/import/preview`.
 *
 * The import path parses attacker-shaped input — an arbitrary zip — entirely in
 * memory, so every dimension that an attacker controls is bounded BEFORE any
 * work is done on it. Each cap is the answer to one concrete attack:
 *
 * - `MAX_IMPORT_BASE64_CHARS`  — how much we are willing to receive at all.
 *   Also the route's `bodyLimit` (plus a small JSON envelope), so the global
 *   1 MiB body cap in `app.ts` does not silently 413 a legitimate archive.
 * - `MAX_ARCHIVE_ENTRIES`      — a central directory with a million entries is
 *   a cheap way to make the parser loop forever.
 * - `MAX_ENTRY_UNCOMPRESSED`   — one entry that inflates to gigabytes (zip
 *   bomb). Checked against the DECLARED size before inflating AND enforced by
 *   zlib's `maxOutputLength`, because a header can lie.
 * - `MAX_TOTAL_UNCOMPRESSED`   — the nested/aggregate variant of the same bomb.
 *
 * Ratios matter more than the exact numbers: base64 is 4/3 of the bytes it
 * carries, so ~4 MiB of base64 is a ~3 MiB archive, which the 8 MiB total
 * uncompressed cap then bounds at a ~2.7× expansion ratio.
 */
export const MAX_IMPORT_BASE64_CHARS = 4 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 512;
export const MAX_ENTRY_UNCOMPRESSED_BYTES = 1024 * 1024;
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 8 * 1024 * 1024;

/** Slack over `MAX_IMPORT_BASE64_CHARS` for the JSON envelope + filename. */
export const IMPORT_BODY_LIMIT_BYTES = MAX_IMPORT_BASE64_CHARS + 8 * 1024;

/** Derived name/description are user-facing single lines, not documents. */
export const MAX_IMPORT_NAME_CHARS = 120;
export const MAX_IMPORT_DESCRIPTION_CHARS = 300;

/** Last-resort skill name when nothing in the file yields one. */
export const IMPORT_FALLBACK_NAME = 'imported-skill';

/**
 * Error codes for the import path. Every one of them is a 422 — a malformed or
 * hostile upload is bad INPUT, not a server fault, and the UI needs to tell the
 * user which limit they hit rather than showing "something went wrong".
 */
export const SKILL_IMPORT_CODES = {
  /** Encoded payload over `MAX_IMPORT_BASE64_CHARS`. */
  tooLarge: 'skill_import_too_large',
  /** `content_base64` is not base64 / decodes to nothing. */
  invalidBase64: 'skill_import_invalid_base64',
  /** Extension is neither `.md`/`.markdown` nor `.zip`. */
  unsupportedFile: 'skill_import_unsupported_file',
  /** Truncated, not a zip, or zip64 (which we do not implement). */
  badArchive: 'skill_import_bad_archive',
  /** Zip-slip: an entry path that escapes the archive root. */
  unsafePath: 'skill_import_unsafe_path',
  tooManyEntries: 'skill_import_too_many_entries',
  entryTooLarge: 'skill_import_entry_too_large',
  archiveTooLarge: 'skill_import_archive_too_large',
  /** A zip with no readable markdown entry — nothing to preview. */
  noMarkdown: 'skill_import_no_markdown',
  /** The markdown is empty once whitespace is removed. */
  empty: 'skill_import_empty',
} as const;

/**
 * System prompt for the eval harness.
 *
 * The point of an eval is to measure ONE skill, so the harness prompt is
 * deliberately empty of review policy: it says how to answer, never what to
 * look for. The skill body — rendered by `assemblePrompt` into the
 * `## Skills / rules` section — is the only independent variable. Swapping the
 * agent's own system prompt in here would measure the agent, not the skill.
 */
export const EVAL_HARNESS_PROMPT = [
  'You are a code-review harness used to evaluate ONE review skill in isolation.',
  '',
  'The skill under test is supplied verbatim in the "Skills / rules" section. It is',
  'the ONLY review policy you have. Apply it to the diff and report exactly what it',
  '— and nothing else — would flag. Do not add findings the skill does not ask for,',
  'and do not withhold findings it does ask for.',
  '',
  'Rules:',
  '- Every finding must cite a file and a line range that exists in the diff.',
  '- Use the severity the skill prescribes; when the skill is silent, use WARNING.',
  '- Return an empty findings array when the skill has nothing to say about this diff.',
].join('\n');
