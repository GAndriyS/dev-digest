/**
 * The A/B pair guard, as a test. No model, no network — it reads two files off disk.
 *
 * This is the second non-model unit test in the package, and it exists for the same reason as the
 * first: a number that is quietly wrong is worse than a number that is missing. A delta measured
 * across a drifted pair looks exactly like a delta measured across a valid one.
 */

import { describe, test, expect } from "vitest";
import { PAIRS, checkPair } from "./pairs.js";

describe("A/B artifact pairs", () => {
  for (const pair of PAIRS) {
    test(`${pair.variant} is still a faithful copy of ${pair.source}`, () => {
      const issues = checkPair(pair);
      expect(issues, issues.join("\n")).toEqual([]);
    });
  }
});
