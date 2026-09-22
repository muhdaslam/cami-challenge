import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The Postgres-backed tests share one database and some assert on whole-table state
    // (a row count), so files must not run at the same time.
    fileParallelism: false,
  },
});
