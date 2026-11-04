import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // All test files share one database, so they must not run at the same time.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost:5432/dk_badminton_test',
      ADMIN_ORIGIN: 'http://localhost:5174',
      WEBSITE_ORIGIN: 'http://localhost:5173',
      PAYMENT_TEST_MODE: 'true',
    },
  },
});
