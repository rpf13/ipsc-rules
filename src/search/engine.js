// Hybrid rule search: BM25 keyword search (MiniSearch) + semantic vector search,
// merged with reciprocal rank fusion and boosted by Division names in the question.
// Runs in the browser and in Node (scripts/eval.mjs).
import MiniSearch from 'minisearch'

const STOPWORDS = new Set(
  `a an and are as at be by can do does for from has have how i if in into is it its
  me my of on or so such than that the their them then there these they this to was
  what when where which who why will with would should could may must allowed permitted
  rule rules ipsc`.split(/\s+/),
)

// Shooter slang / abbreviations -> rulebook wording. Keys are matched as whole words.
const SYNONYMS = {
  mag: 'magazine', mags: 'magazines', dq: 'disqualification disqualified', dqs: 'disqualification',
  ad: 'accidental discharge', pf: 'power factor', ro: 'range officer', cro: 'chief range officer',
  rm: 'range master', md: 'match director', cof: 'course of fire', comp: 'compensator',
  comps: 'compensators', 'red dot': 'optical electronic sight', dot: 'optical electronic sight',
  rds: 'optical electronic sight', optic: 'optical sight', scope: 'optical sight', sight: 'sights',
  pcc: 'pistol caliber carbine', sg: 'shotgun', ppe: 'procedural penalty', procedural: 'procedural penalty',
  penalties: 'penalty', squib: 'malfunction squib', ulsc: 'unload show clear',
  'unload and show clear': 'unload show clear', holstered: 'holster', 'make ready': 'load make ready',
  ammo: 'ammunition', bullet: 'bullet', caliber: 'caliber calibre', calibre: 'caliber calibre',
  length: 'length', capacity: 'capacity rounds', rounds: 'rounds capacity', 'no shoot': 'no-shoot',
  noshoot: 'no-shoot', mike: 'miss', mikes: 'misses', alpha: 'A zone', charlie: 'C zone', delta: 'D zone',
  chrono: 'chronograph', '180': 'muzzle uprange safe angles of fire', muzzle: 'muzzle safe angles',
  belt: 'belt', reshoot: 'reshoot', arbitration: 'arbitration appeal', appeal: 'appeal arbitration',
  timer: 'timer start signal', beep: 'start signal',
}

// Division names, longest first, so "production optics" wins over "optics".
const DIVISIONS = [
  'manual action contemporary', 'manual action bolt', 'semi auto standard', 'semi auto open',
  'production optics', 'standard manual', 'pcc optics', 'pcc iron', 'production', 'standard',
  'classic', 'revolver', 'optics', 'modified', 'open', 'iron', 'sao', 'sas', 'mac', 'mab',
]
const DIVISION_ALIASES = { sao: 'semi auto open', sas: 'semi auto standard', mac: 'manual action contemporary', mab: 'manual action bolt' }

export function stem(w) {
  w = w.toLowerCase().replace(/['’]s$/, '')
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.length > 4 && w.endsWith('sses')) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) w = w.slice(0, -1)
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2)
  return w
}

function processTerm(term) {
  const t = term.toLowerCase()
  if (STOPWORDS.has(t)) return null
  return stem(t)
}

function tokenize(text) {
  // keep rule numbers like 5.1.3 and measurements like 141.25 together
  return text.match(/\d+(?:\.\d+)+|[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) || []
}

// Discipline names only select the rulebook; as search terms they match almost everything.
const DISCIPLINE_WORDS = /\b(handguns?|pistols?|shotguns?|rifles?|carbines?|pcc|pistol caliber carbine)\b/g

/** Returns { query, extra }: the cleaned user query and synonym expansions (weighted lower). */
export function expandQuery(q) {
  const s = ' ' + q.toLowerCase().replace(/[?!,;:()"]/g, ' ') + ' '
  const extra = []
  for (const [k, v] of Object.entries(SYNONYMS)) {
    if (s.includes(` ${k} `) && !/^(pcc|sg)$/.test(k)) extra.push(v)
  }
  const query = s.replace(DISCIPLINE_WORDS, ' ').replace(/\s+/g, ' ').trim()
  return { query: query || s.trim(), extra: extra.join(' ') }
}

/** Text to embed for the semantic search: the question plus slang expansions. */
export function semanticText(q) {
  const { extra } = expandQuery(q)
  return extra ? `${q} (${extra})` : q
}

export function detectDivisions(q) {
  let s = ' ' + q.toLowerCase().replace(/[^a-z0-9 ]/g, ' ') + ' '
  const found = []
  for (const d of DIVISIONS) {
    if (s.includes(` ${d} `)) {
      found.push(DIVISION_ALIASES[d] || d)
      s = s.replace(` ${d} `, ' ')
    }
  }
  return found
}

const RULE_REF = /^(?:rule\s+)?(\d{1,2}(?:\.\d{1,2}){1,4})$/i

export class RuleSearch {
  /**
   * @param {{docs: object[], chunks: object[], dim: number}} index
   * @param {Int8Array} vectors
   */
  constructor(index, vectors) {
    this.docs = Object.fromEntries(index.docs.map((d) => [d.id, d]))
    this.chunks = index.chunks
    this.byId = new Map(this.chunks.map((c, i) => [c.id, i]))
    this.dim = index.dim
    this.vectors = vectors
    this.mini = new MiniSearch({
      idField: 'i',
      fields: ['title', 'heading', 'text'],
      storeFields: [],
      tokenize,
      processTerm,
    })
    this.mini.addAll(
      this.chunks.map((c, i) => ({
        i,
        title: c.title || '',
        heading: `${c.chapter || ''} ${c.section || ''}`,
        text: c.text,
        d: c.d,
      })),
    )
  }

  chunk(id) {
    const i = this.byId.get(id)
    return i === undefined ? null : this.chunks[i]
  }

  keyword(q, allowed) {
    const { query, extra } = expandQuery(q)
    const own = new Set(tokenize(query).map(processTerm).filter(Boolean))
    const res = this.mini.search(`${query} ${extra}`, {
      boost: { title: 3, heading: 1.5, text: 1 },
      boostTerm: (term) => (own.has(term) ? 1 : 0.6),
      fuzzy: (term) => (term.length > 5 ? 0.15 : 0),
      prefix: (term) => term.length > 4,
      combineWith: 'OR',
      filter: (r) => allowed(r.id),
    })
    return res.slice(0, 100).map((r) => r.id)
  }

  semantic(qvec, allowed, k = 100) {
    const { dim, vectors } = this
    const scores = []
    for (let i = 0; i < this.chunks.length; i++) {
      if (!allowed(i)) continue
      let s = 0
      const o = i * dim
      for (let j = 0; j < dim; j++) s += qvec[j] * vectors[o + j]
      scores.push([i, s / 127])
    }
    scores.sort((a, b) => b[1] - a[1])
    return scores.slice(0, k)
  }

  /**
   * @param {string} query
   * @param {{disciplines?: string[], qvec?: Float32Array|null, limit?: number}} opts
   */
  search(query, { disciplines = null, qvec = null, limit = 12 } = {}) {
    const q = query.trim()
    if (!q) return { results: [], divisions: [] }
    const set = disciplines && disciplines.length ? new Set(disciplines) : null
    const allowed = (i) => !set || set.has(this.chunks[i].d)

    // Direct rule lookup: "5.1.3" or "rule 5.1.3"
    const m = q.match(RULE_REF)
    if (m) {
      const hits = this.chunks
        .map((c, i) => [c, i])
        .filter(([c, i]) => allowed(i) && c.kind !== 'item' && (c.id.endsWith(`-${m[1]}`) || c.id.split('-')[1]?.startsWith(m[1] + '.')))
        .slice(0, 40)
        .map(([c]) => ({ chunk: c, score: 1, why: 'rule' }))
      if (hits.length) return { results: hits, divisions: [] }
    }

    const divisions = detectDivisions(q)
    const fused = new Map()
    const K = 60
    const add = (i, rank, w, src) => {
      const e = fused.get(i) || { s: 0, src: new Set() }
      e.s += w / (K + rank)
      e.src.add(src)
      fused.set(i, e)
    }
    this.keyword(q, allowed).forEach((i, r) => add(i, r, 1.0, 'kw'))
    if (qvec) this.semantic(qvec, allowed).forEach(([i], r) => add(i, r, 1.2, 'sem'))

    const out = []
    for (const [i, e] of fused) {
      const c = this.chunks[i]
      let s = e.s
      if (e.src.size > 1) s *= 1.15 // found by both methods
      if (divisions.length) s *= divisionBoost(c, divisions)
      out.push({ chunk: c, score: s })
    }
    out.sort((a, b) => b.score - a.score)
    const top = out[0]?.score || 0
    return { results: out.filter((r) => r.score >= top * 0.45).slice(0, limit), divisions }
  }
}

function divisionBoost(c, divisions) {
  const chapter = (c.chapter || '').toLowerCase()
  const isAppendixD = /^appendix d/.test(chapter)
  let best = 1
  for (const d of divisions) {
    // Handgun: one appendix per Division, e.g. "Appendix D6: Optics Division"
    if (chapter.endsWith(`: ${d} division`)) best = Math.max(best, 2.2)
    else if (isAppendixD && (c.section || '').toLowerCase().includes(d)) best = Math.max(best, 2.0)
    // Shotgun/Rifle/PCC: a single Division table with one column per Division
    else if (isAppendixD && c.kind === 'item' && c.text.toLowerCase().includes(d)) best = Math.max(best, 1.8)
    else if (isAppendixD) best = Math.max(best, 1.2)
    else if (c.text.toLowerCase().includes(`${d} division`)) best = Math.max(best, 1.3)
  }
  return best
}
