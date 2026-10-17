import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Runs the quantitative evaluation harness (tests/eval) and writes docs/EVALUATION.md.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify('test') },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['tests/eval/**/*.eval.ts'] },
});
