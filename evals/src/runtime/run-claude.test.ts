/**
 * Model-free unit tests for the trace-extraction helpers. Runs in the same lane as
 * src/records/stats.test.ts — no session, no tokens.
 */

import { describe, it, expect, vi } from "vitest";
import { agentName, runClaude } from "./run-claude.js";

// The SDK is replaced by a session that answers once and then hangs until it is aborted — the
// shape of every run that used to be killed by vitest instead of by itself. The factory is
// hoisted, so it may not close over anything defined in this file.
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({ options }: { options: { abortController?: AbortController } }) =>
    (async function* () {
      yield {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "partial answer" },
            { type: "tool_use", name: "Read", input: { file_path: "server/AGENTS.md" } },
          ],
          usage: { output_tokens: 7 },
        },
      };
      await new Promise((_resolve, reject) => {
        options.abortController?.signal.addEventListener("abort", () =>
          reject(new Error("aborted by test")),
        );
      });
    })(),
}));

describe("agentName", () => {
  it("passes a clean name through", () => {
    expect(agentName("spec-creator")).toBe("spec-creator");
    expect(agentName("architecture-reviewer-lite")).toBe("architecture-reviewer-lite");
    expect(agentName("plugin:my-agent")).toBe("plugin:my-agent");
  });

  // The verbatim value observed in a 2026-08-25 run, where the model emitted malformed tool-call
  // syntax and the whole rest of the XML landed in `subagent_type`. Everything downstream compares
  // by exact membership, so this string made `stopWhen` miss, the nested subagent run to
  // completion, and the case vanish on the vitest timeout.
  it("recovers the name from a malformed tool call", () => {
    const mangled = 'spec-creator</subagent_type>\n<parameter name="prompt">Напиши спеку для фічі';
    expect(agentName(mangled)).toBe("spec-creator");
  });

  it("trims surrounding whitespace", () => {
    expect(agentName("  spec-creator  ")).toBe("spec-creator");
  });

  // Empty string, not a partial guess: the caller drops falsy names rather than recording garbage.
  it("yields an empty string when there is no name to recover", () => {
    expect(agentName("<garbage>")).toBe("");
    expect(agentName(undefined)).toBe("");
    expect(agentName(null)).toBe("");
  });
});

/**
 * The session's own deadline. Before it existed, a stuck run was killed by vitest — and record()
 * fires in a `finally` a kill never reaches, so the case left NO row: a 6-case run printed a green
 * "5/5" with the sixth silently absent (2026-08-25). A run that dies of its own timeout has to
 * come back as data.
 */
describe("runClaude deadline", () => {
  it("returns a partial, failed result instead of hanging past its budget", async () => {
    const result = await runClaude("anything", { timeoutMs: 50 });

    expect(result.timedOut).toBe(true);
    expect(result.isError).toBe(true);
    // The point of not throwing: the trace collected before the deadline survives, so the row
    // records what the session actually managed to do.
    expect(result.text).toContain("partial answer");
    expect(result.text).toContain("RUN TIMED OUT");
    expect(result.toolsUsed).toEqual(["Read"]);
    expect(result.filesRead).toEqual(["server/AGENTS.md"]);
    expect(result.metrics.durationMs).toBeGreaterThan(0);
  });
});
