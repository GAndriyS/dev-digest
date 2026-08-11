import { defineConfig } from 'vitest/config';

// Deliberately NO alias for `@devdigest/shared` here (unlike reviewer-core's
// vitest.config.ts). This package only ever `import type`s from that path —
// a value import is a bug, and the first offending test should fail to
// resolve rather than silently pull in the alias like the other packages do.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
