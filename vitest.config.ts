import { defineConfig } from "vitest/config";

/**
 * Archivore's tests only.
 *
 * Crosscheck lives in `crosscheck/` until it's split into its own repository
 * (see crosscheck/SPLIT-OUT.md) and has its own package.json and test command.
 * Without this, `npm test` here would run both projects' suites.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
