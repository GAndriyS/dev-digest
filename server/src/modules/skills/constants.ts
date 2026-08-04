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
export const NO_PROVIDER_KEY_CODE = 'no_provider_key';

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
