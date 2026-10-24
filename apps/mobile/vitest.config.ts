import { defineConfig } from 'vitest/config';

// The shell's pure helpers only (src/shell.ts); React Native screens are checked by tsc and Metro.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
