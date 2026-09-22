import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/e2e/**/*.e2e.ts'],
    fileParallelism: false,
    testTimeout: 240_000,
    hookTimeout: 240_000,
    env: {
      NEXT_PUBLIC_BASE_API_URL: process.env.CRYPLE_E2E_API ?? 'http://localhost:8081',
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
