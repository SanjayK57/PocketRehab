// Copies the MediaPipe WebAssembly runtime from node_modules into public/ so the
// app serves it from its own origin (no CDN, works offline once cached).
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const dest = join(root, 'public/mediapipe/wasm');
const files = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

mkdirSync(dest, { recursive: true });
for (const file of files) {
  const from = join(src, file);
  if (!existsSync(from)) {
    console.error(`[copy-mediapipe] missing ${from}. Run npm install first.`);
    process.exit(1);
  }
  copyFileSync(from, join(dest, file));
}
console.log(`[copy-mediapipe] copied ${files.length} files to public/mediapipe/wasm`);
