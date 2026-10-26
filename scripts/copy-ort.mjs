// Copies the onnxruntime-web WASM runtime into public/ort so the app needs no CDN.
// Runs automatically after `npm install`.
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'onnxruntime-web', 'dist')
const dest = join(root, 'public', 'ort')
await mkdir(dest, { recursive: true })
for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await copyFile(join(src, f), join(dest, f))
}
console.log('copied onnxruntime-web wasm to public/ort')
