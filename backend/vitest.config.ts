import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Each file has its own in-memory D1, but starting the local runtime is heavy, so files run one at a time.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      ADMIN_ORIGIN: 'http://localhost:5174',
      WEBSITE_ORIGIN: 'http://localhost:5173',
      PAYMENT_SIMULATOR: 'true',
    },
  },
});
