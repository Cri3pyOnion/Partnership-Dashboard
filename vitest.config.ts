import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'shared', environment: 'node', include: ['test/shared/**/*.test.ts'] } },
      { test: { name: 'db', environment: 'node', include: ['test/db/**/*.test.ts'] } },
      { test: { name: 'repo', environment: 'node', include: ['test/repo/**/*.test.ts'] } },
      {
        plugins: [cloudflareTest({
          wrangler: { configPath: './wrangler.jsonc' },
          // The pool bundles an older workerd than the project's compatibility_date.
          miniflare: { compatibilityDate: '2026-08-01' },
        })],
        test: { name: 'worker', include: ['test/worker/**/*.test.ts'] },
      },
      // Later: `admin` (jsdom, Task 10).
    ],
  },
});
