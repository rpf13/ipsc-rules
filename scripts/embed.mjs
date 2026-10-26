// Builds the search index shipped with the app:
//   public/data/index.json  - rulebook metadata + chunks
//   public/data/vectors.bin - int8 embeddings, one DIM-sized row per chunk (same order)
// Usage: npm run embed   (after `python scripts/parse_rulebooks.py` and `npm run fetch-model`)
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline, env } from '@huggingface/transformers'
import { MODEL_ID, DIM } from './config.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
env.localModelPath = join(root, 'public', 'models')
env.allowRemoteModels = false

const { docs, chunks } = JSON.parse(await readFile(join(root, 'data', 'chunks.json'), 'utf8'))
const byId = new Map(chunks.map((c) => [c.id, c]))

// Text the embedding model sees: the heading path gives short sub-rules their context.
export function passage(c) {
  const parent = c.parent ? byId.get(c.parent) : null
  const head = [c.chapter, c.section, c.title].filter(Boolean).join(' > ')
  const ctx = parent && parent.text.length < 300 ? `${parent.text} ` : ''
  return `${head}. ${ctx}${c.text}`.slice(0, 2000)
}

const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' })
const vectors = new Int8Array(chunks.length * DIM)
const BATCH = 32
for (let i = 0; i < chunks.length; i += BATCH) {
  const batch = chunks.slice(i, i + BATCH).map(passage)
  const out = await extractor(batch, { pooling: 'cls', normalize: true })
  const data = out.data
  for (let j = 0; j < batch.length; j++) {
    for (let k = 0; k < DIM; k++) {
      vectors[(i + j) * DIM + k] = Math.max(-127, Math.min(127, Math.round(data[j * DIM + k] * 127)))
    }
  }
  process.stdout.write(`\rembedded ${Math.min(i + BATCH, chunks.length)}/${chunks.length}`)
}
process.stdout.write('\n')

const slim = chunks.map(({ id, d, kind, label, chapter, section, title, text, page, pdfPage, parent }) => ({
  id, d, kind, label, chapter, section, title, text, page, pdfPage, parent,
}))
const outDir = join(root, 'public', 'data')
await mkdir(outDir, { recursive: true })
await writeFile(
  join(outDir, 'index.json'),
  JSON.stringify({ model: MODEL_ID, dim: DIM, builtAt: new Date().toISOString(), docs, chunks: slim }),
)
await writeFile(join(outDir, 'vectors.bin'), Buffer.from(vectors.buffer))

console.log(`wrote ${chunks.length} chunks, ${(vectors.byteLength / 1024).toFixed(0)} KiB vectors`)
