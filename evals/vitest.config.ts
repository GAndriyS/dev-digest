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
    // One session per test; a few files can run concurrently. Keep it modest to stay cheap.
    fileParallelism: true,
    reporters: ["default", new TrendReporter()],
  },
});
