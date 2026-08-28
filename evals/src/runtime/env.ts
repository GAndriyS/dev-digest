/**
 * Child-process environment for the SDK. Two supported backends:
 *
 *   subscription (default) — strip any API key so the SDK uses the Claude Code subscription.
 *   openrouter             — point the SDK at OpenRouter's Anthropic-compatible endpoint
 *                            (or a local translating proxy like LiteLLM) via ANTHROPIC_BASE_URL.
 *
 * The whole harness (subagents, skills, tool use, CLAUDE.md) still runs inside the Agent SDK;
 * only the model inference is redirected. Select with EVAL_BACKEND=openrouter.
 */

const BACKEND = process.env.EVAL_BACKEND ?? "subscription";

/**
 * Copy the current env, configured for the selected inference backend.
 *
 * subscription: an API key in the environment takes priority over the Claude Code subscription,
 *   so we delete it — without this every eval run would silently bill API tokens.
 *
 * openrouter: set ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN and blank ANTHROPIC_API_KEY so the
 *   SDK speaks the Anthropic wire protocol to OpenRouter instead of api.anthropic.com. The base
 *   URL must have NO trailing slash. Override OPENROUTER_BASE_URL to point at a local LiteLLM
 *   proxy (e.g. http://localhost:4000) when routing to models that need Anthropic<->OpenAI
 *   translation.
 */
export function subscriptionEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;

  if (BACKEND === "openrouter") {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("EVAL_BACKEND=openrouter but OPENROUTER_API_KEY is not set");
    env.ANTHROPIC_BASE_URL = (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api").replace(/\/$/, "");
    env.ANTHROPIC_AUTH_TOKEN = key;
    env.ANTHROPIC_API_KEY = ""; // blank, not deleted — stops the SDK falling back to Anthropic auth

    // EVAL_MODEL only reaches the MAIN session (runClaude passes it to query()). A DISPATCHED
    // subagent picks its own model from its frontmatter alias — `model: sonnet`, `model: opus` —
    // which the SDK resolves to an Anthropic model id. That id then goes to whatever endpoint
    // ANTHROPIC_BASE_URL names, and neither OpenRouter's Anthropic Skin nor the LiteLLM proxy
    // knows it. Measured in CI 2026-08-25: the workflow tier dispatched `spec-creator` and the
    // proxy answered `openrouter/claude-opus-4-8 is not a valid model ID`, while the main session
    // ran on the configured model throughout. Pointing all three aliases at EVAL_MODEL is what
    // makes a dispatch survive a redirected backend.
    const model = process.env.EVAL_MODEL;
    if (model) {
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = model;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = model;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = model;
    }
    return env;
  }

  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}
