import { stem, expandQuery } from './engine.js'

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const SKIP = new Set(['the', 'and', 'for', 'what', 'how', 'can', 'are', 'with', 'does', 'is', 'in', 'of', 'a', 'to', 'my', 'allowed', 'rule', 'rules', 'ipsc'])

/** Build a regex matching the (stemmed) words of the query and their synonyms. */
export function termRegex(query) {
  const { query: q, extra } = expandQuery(query)
  const words = `${q} ${extra}`.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.-]*/gu) || []
  const stems = [...new Set(words.filter((w) => w.length > 2 && !SKIP.has(w)).map(stem))]
  if (!stems.length) return null
  stems.sort((a, b) => b.length - a.length)
  return new RegExp(`\\b(${stems.map(reEsc).join('|')})[\\p{L}]*`, 'giu')
}

/** HTML for a chunk text with query terms marked and the asked-about Division's table cell bolded. */
export function highlight(text, re, divisions = []) {
  let html = esc(text)
  for (const d of divisions) {
    // "SG Standard: Max. of 9 rounds loaded;" -> bold that cell
    const cell = new RegExp(`((?:^|; |: )(?:[A-Z]{2,4} )?${reEsc(d)}(?: [A-Z]{2,4})?: )([^;\\n]+)`, 'gi')
    html = html.replace(cell, (_, a, b) => `${a}<strong class="cell">${b}</strong>`)
  }
  if (re) html = html.replace(re, (m) => `<mark>${m}</mark>`)
  return html.replace(/\n/g, '<br>')
}
