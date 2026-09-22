import { defineConfig } from 'vitest/config';

// Only the pure logic (URL state, filter maths) is unit-tested here; no DOM environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
