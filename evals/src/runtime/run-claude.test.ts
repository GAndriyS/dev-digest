/**
 * Model-free unit tests for the trace-extraction helpers. Runs in the same lane as
 * src/records/stats.test.ts — no session, no tokens.
 */

import { describe, it, expect } from "vitest";
import { agentName } from "./run-claude.js";

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
