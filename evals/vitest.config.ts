import { defineConfig } from "vitest/config";
import TrendReporter from "./src/trend-reporter.js";
import { TEST_TIMEOUT_MS } from "./src/config.js";

export default defineConfig({
  test: {
    // *.eval.ts = model-backed evals; src/**/*.test.ts = the pure stats unit tests.
    include: ["**/*.eval.ts", "src/**/*.test.ts"],
    // Real Claude sessions (and a subagent dispatch) are slow — give them room. The number is
    // NOT written here: runClaude() has to expire BEFORE vitest does (a killed test writes no
    // record at all), and two literals in two files is exactly how that invariant rots. Both
    // ceilings come from config.ts — see its "Time budget" block.
    testTimeout: TEST_TIMEOUT_MS,
    hookTimeout: TEST_TIMEOUT_MS,
    // One live session at a time. Concurrent files ran strict+lite sessions in parallel on the
    // same subscription, and the sessions queued behind each other into the 180s deadline: in one
    // n=5 repeat, 14 of 40 sessions died at zero turns, in whole bands (measured 2026-08-26).
    // Serial is slower on wall-clock and buys back the sample; the model-free unit tests in src/
    // pay only milliseconds for it.
    fileParallelism: false,
    reporters: ["default", new TrendReporter()],
  },
});
