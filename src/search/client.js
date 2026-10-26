// Loads the prebuilt index and talks to the embedding worker.
import { reactive } from 'vue'
import { RuleSearch, semanticText } from './engine.js'

export const status = reactive({
  index: 'loading', // loading | ready | error
  model: 'idle', // idle | loading | ready | error | off
  progress: 0,
  error: '',
})

let engine = null
let worker = null
let seq = 0
const pending = new Map()

export async function loadIndex() {
  const base = import.meta.env.BASE_URL
  try {
    const [index, buf] = await Promise.all([
      fetch(`${base}data/index.json`).then((r) => r.json()),
      fetch(`${base}data/vectors.bin`).then((r) => r.arrayBuffer()),
    ])
    engine = new RuleSearch(index, new Int8Array(buf))
    status.index = 'ready'
    return engine
  } catch (e) {
    status.index = 'error'
    status.error = String(e)
    throw e
  }
}

export function startModel() {
  if (worker) return
  status.model = 'loading'
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') status.progress = data.progress
    else if (data.type === 'ready') status.model = 'ready'
    else if (data.type === 'error') {
      status.model = 'error'
      status.error = data.error
    } else if (data.type === 'vector') {
      pending.get(data.id)?.(data.vector)
      pending.delete(data.id)
    }
  }
  worker.onerror = (e) => {
    status.model = 'error'
    status.error = e.message
  }
}

export function stopModel() {
  worker?.terminate()
  worker = null
  status.model = 'off'
}

function embed(text) {
  if (!worker || status.model !== 'ready') return Promise.resolve(null)
  const id = ++seq
  return new Promise((resolve) => {
    pending.set(id, resolve)
    worker.postMessage({ type: 'embed', id, text })
  })
}

/** Keyword results right away, then (if the model is ready) hybrid results. */
export async function search(query, disciplines, onResults) {
  if (!engine) return
  const fast = engine.search(query, { disciplines })
  onResults(fast, false)
  const qvec = await embed(semanticText(query))
  onResults(qvec ? engine.search(query, { disciplines, qvec }) : fast, true)
}

export const getEngine = () => engine
