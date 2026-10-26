// Runs a set of real-world questions through the search engine and checks that the
// expected rule shows up in the top results.  Usage: npm run eval [-- "custom question" [discipline]]
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline, env } from '@huggingface/transformers'
import { RuleSearch, semanticText } from '../src/search/engine.js'
import { MODEL_ID, QUERY_PREFIX } from './config.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
env.localModelPath = join(root, 'public', 'models')
env.allowRemoteModels = false

// [question, discipline filter (null = all), expected chunk ids (any of them in top 5 = pass)]
const CASES = [
  ['What is the maximum magazine length in optics division', 'handgun', ['hg-D6#8']],
  ['max mag length production optics', 'handgun', ['hg-D4a#8']],
  ['How many rounds can I load in production division?', 'handgun', ['hg-D4#18.2', 'hg-D4#9']],
  ['minimum power factor for major in standard', 'handgun', ['hg-D2#1']],
  ['What happens if I drop my gun?', 'handgun', ['hg-10.5.3']],
  ['Is it a DQ when my finger is in the trigger guard while moving?', 'handgun', ['hg-10.5.9', 'hg-10.5.11']],
  ['breaking the 180', 'handgun', ['hg-10.5.2']],
  ['accidental discharge over the berm', 'handgun', ['hg-10.4.1', 'hg-10.4']],
  ['how far can the holster be from the body', 'handgun', ['hg-5.2.5', 'hg-D6#10']],
  ['squib load', 'handgun', ['hg-5.7.6', 'hg-5.7.1', 'hg-5.7']],
  ['what does a miss cost', 'handgun', ['hg-9.4.4']],
  ['shooting through a no-shoot', 'handgun', ['hg-9.4.2', 'hg-9.4.3']],
  ['Can I use a red dot in production division?', 'handgun', ['hg-D4#12']],
  ['bipod allowed in semi auto standard', 'rifle', ['rf-D#7', 'rf-D#11']],
  ['maximum capacity in SG standard', 'shotgun', ['sg-D#12']],
  ['PCC maximum bullet velocity', 'pcc', ['pcc-D#2']],
  ['chamber flag requirement', 'pcc', ['pcc-5.2.1']],
  ['How long do I have to file an appeal?', 'handgun', ['hg-11.3.1', 'hg-11.3']],
  ['appeal fee', null, ['hg-11.4.1', 'sg-11.4.1', 'rf-11.4.1', 'pcc-11.4.1']],
  ['Senior category age', 'handgun', ['hg-A2:senior']],
  ['minimum number of stages for a level III match', 'handgun', ['hg-A1#21']],
  ['5.2.5', 'handgun', ['hg-5.2.5']],
  ['what is a compensator', 'handgun', ['hg-12.5:compensator']],
  ['definition of allied equipment', 'handgun', ['hg-12.5:allied-equipment']],
  ['Is a sling allowed on a PCC?', 'pcc', ['pcc-5.2.3']],
  ['when is a competitor considered a super senior', null, ['hg-A2:super-senior', 'sg-A2:super-senior', 'rf-A2:super-senior', 'pcc-A2:super-senior']],
]

const index = JSON.parse(await readFile(join(root, 'public', 'data', 'index.json'), 'utf8'))
const buf = await readFile(join(root, 'public', 'data', 'vectors.bin'))
const engine = new RuleSearch(index, new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength))
const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' })
const embed = async (q) => (await extractor(QUERY_PREFIX + semanticText(q), { pooling: 'cls', normalize: true })).data

const custom = process.argv[2]
const cases = custom ? [[custom, process.argv[3] || null, []]] : CASES
let pass = 0
for (const [q, d, expect] of cases) {
  const { results, divisions } = engine.search(q, { disciplines: d ? [d] : null, qvec: await embed(q) })
  const ids = results.map((r) => r.chunk.id)
  const rank = ids.findIndex((id) => expect.includes(id))
  const ok = rank >= 0 && rank < 5
  pass += ok
  console.log(`${ok ? 'PASS' : 'FAIL'} [${rank}] ${q}${divisions.length ? `  {${divisions}}` : ''}`)
  if (!ok || custom)
    for (const r of results.slice(0, custom ? 10 : 5))
      console.log(`      ${r.score.toFixed(4)} ${r.chunk.id.padEnd(14)} ${r.chunk.text.slice(0, 90).replace(/\n/g, ' ')}`)
}
if (!custom) console.log(`\n${pass}/${cases.length} passed`)
