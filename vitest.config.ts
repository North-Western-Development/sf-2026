import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@subspace/constants': path.resolve(__dirname, 'packages/constants/src/index.ts'),
      '@subspace/database': path.resolve(__dirname, 'packages/database/src/index.ts'),
      '@subspace/crypto': path.resolve(__dirname, 'packages/crypto/src/index.ts'),
    },
  },
});
