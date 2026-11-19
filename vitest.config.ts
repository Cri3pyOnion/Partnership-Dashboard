import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'shared', environment: 'node', include: ['test/shared/**/*.test.ts'] } },
      { test: { name: 'db', environment: 'node', include: ['test/db/**/*.test.ts'] } },
      { test: { name: 'repo', environment: 'node', include: ['test/repo/**/*.test.ts'] } },
      // Later: `worker` (@cloudflare/vitest-pool-workers, Task 5/6) and `admin` (jsdom, Task 10).
    ],
  },
});
