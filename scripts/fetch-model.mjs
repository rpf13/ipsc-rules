// Downloads the embedding model into public/models so the app can run without any CDN.
// Usage: npm run fetch-model
import { mkdir, writeFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODEL_ID } from './config.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const files = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model_quantized.onnx',
]

for (const f of files) {
  const dest = join(root, 'public', 'models', MODEL_ID, f)
  try {
    await access(dest)
    console.log(`have  ${f}`)
    continue
  } catch {}
  const url = `https://huggingface.co/${MODEL_ID}/resolve/main/${f}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
  console.log(`fetched ${f}`)
}
