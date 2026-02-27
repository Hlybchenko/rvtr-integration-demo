import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{mjs,ts}'],
    environmentMatchGlobs: [
      // Use jsdom for component tests
      ['src/pages/**/*.test.tsx', 'jsdom'],
    ],
    setupFiles: [],
  },
});
