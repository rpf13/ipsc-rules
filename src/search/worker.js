// Web worker: loads the embedding model (served from this site) and embeds search queries,
// so the UI never freezes while the model runs.
import { pipeline, env } from '@huggingface/transformers'
import { MODEL_ID, QUERY_PREFIX } from '../../scripts/config.mjs'

const base = new URL(import.meta.env.BASE_URL, self.location.origin)
env.allowRemoteModels = false
env.allowLocalModels = true
// Must be a path, not a full URL: transformers.js 4.x skips its local-file check for http(s) URLs
// and would then silently load the pipeline without a tokenizer.
env.localModelPath = new URL('models/', base).pathname
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL('ort/ort-wasm-simd-threaded.mjs', base).href,
  wasm: new URL('ort/ort-wasm-simd-threaded.wasm', base).href,
}
env.backends.onnx.wasm.numThreads = 1

let extractor = null
const ready = (async () => {
  try {
    extractor = await pipeline('feature-extraction', MODEL_ID, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p) => {
        if (p.status === 'progress' && p.file?.endsWith('.onnx')) {
          self.postMessage({ type: 'progress', progress: p.progress })
        }
      },
    })
    self.postMessage({ type: 'ready' })
  } catch (e) {
    self.postMessage({ type: 'error', error: String(e?.message || e) })
  }
})()

self.onmessage = async ({ data }) => {
  if (data.type !== 'embed') return
  await ready
  if (!extractor) return self.postMessage({ type: 'vector', id: data.id, vector: null })
  try {
    const out = await extractor(QUERY_PREFIX + data.text, { pooling: 'cls', normalize: true })
    self.postMessage({ type: 'vector', id: data.id, vector: out.data })
  } catch (e) {
    self.postMessage({ type: 'vector', id: data.id, vector: null, error: String(e?.stack || e) })
  }
}
