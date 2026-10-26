<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useTheme } from 'vuetify'
import {
  mdiMagnify, mdiFilePdfBox, mdiChevronDown, mdiChevronUp, mdiBrain, mdiCheckCircle,
  mdiAlertCircleOutline, mdiThemeLightDark, mdiInformationOutline, mdiShareVariant, mdiContentCopy,
} from '@mdi/js'
import { loadIndex, startModel, stopModel, search, status, getEngine } from './search/client.js'
import { highlight, termRegex } from './search/highlight.js'

const DISCIPLINES = [
  { id: 'handgun', label: 'Handgun' },
  { id: 'shotgun', label: 'Shotgun' },
  { id: 'rifle', label: 'Rifle' },
  { id: 'pcc', label: 'PCC' },
  { id: 'all', label: 'All' },
]
const EXAMPLES = [
  'What is the maximum magazine length in Optics Division?',
  'What happens if I drop my gun?',
  'How many rounds in Production Division?',
  'breaking the 180',
  'appeal fee',
  'Is a sling allowed on a PCC?',
]

const params = new URLSearchParams(location.search)
const query = ref(params.get('q') || '')
const discipline = ref(DISCIPLINES.some((d) => d.id === params.get('d')) ? params.get('d') : 'handgun')
const results = ref([])
const divisions = ref([])
const searched = ref('')
const hybrid = ref(false)
const expanded = ref({})
const about = ref(false)
const snackbar = ref('')
const smart = ref(readPref('smart', true))
const theme = useTheme()
const base = import.meta.env.BASE_URL

function readPref(k, dflt) {
  try {
    const v = localStorage.getItem(`ipsc-${k}`)
    return v === null ? dflt : JSON.parse(v)
  } catch {
    return dflt
  }
}
function writePref(k, v) {
  try {
    localStorage.setItem(`ipsc-${k}`, JSON.stringify(v))
  } catch {}
}

const docs = computed(() => (status.index === 'ready' ? getEngine().docs : {}))
const editionLine = computed(() => {
  const ds = discipline.value === 'all' ? Object.values(docs.value) : [docs.value[discipline.value]].filter(Boolean)
  const eds = [...new Set(ds.map((d) => d.edition))]
  return eds.join(', ')
})
const re = computed(() => termRegex(searched.value))

let token = 0
async function run() {
  const q = query.value.trim()
  const url = new URL(location.href)
  q ? url.searchParams.set('q', q) : url.searchParams.delete('q')
  url.searchParams.set('d', discipline.value)
  history.replaceState(null, '', url)
  if (!q || status.index !== 'ready') {
    results.value = []
    searched.value = ''
    return
  }
  const my = ++token
  const filter = discipline.value === 'all' ? null : [discipline.value]
  await search(q, filter, (res, isHybrid) => {
    if (my !== token) return
    results.value = res.results
    divisions.value = res.divisions
    searched.value = q
    hybrid.value = isHybrid
    expanded.value = {}
  })
}

let timer
watch(query, () => {
  clearTimeout(timer)
  timer = setTimeout(run, 350)
})
watch(discipline, run)
watch(smart, (on) => {
  writePref('smart', on)
  on ? startModel() : stopModel()
  if (on) run()
})
watch(() => status.model, (s) => s === 'ready' && searched.value && run())

onMounted(async () => {
  await loadIndex()
  if (smart.value) startModel()
  run()
})

function example(q) {
  query.value = q
}

const engineChunk = (id) => getEngine()?.chunk(id)
function parentOf(c) {
  return c.parent ? engineChunk(c.parent) : null
}
/** Context for a result: neighbouring rules, plus the referenced special conditions for Division tables. */
function neighbours(c) {
  const e = getEngine()
  const i = e.byId.get(c.id)
  const out = new Map()
  for (let j = Math.max(0, i - 3); j <= Math.min(e.chunks.length - 1, i + 3); j++) {
    const n = e.chunks[j]
    if (j !== i && n.d === c.d && n.chapter === c.chapter) out.set(n.id, n)
  }
  const points = [...c.text.matchAll(/points? (\d+)(?:\s*(?:&|and|,)\s*(\d+))?/gi)].flatMap((m) => [m[1], m[2]]).filter(Boolean)
  if (c.kind === 'item' && (points.length || /see below/i.test(c.text))) {
    for (const n of e.chunks) {
      if (n.d !== c.d || n.chapter !== c.chapter || n.id === c.id || n.kind !== 'item') continue
      const num = n.id.split('#')[1]?.split('.')[0]
      if (points.length ? points.includes(num) : n.section) out.set(n.id, n)
    }
  }
  return [...out.values()].sort((a, b) => e.byId.get(a.id) - e.byId.get(b.id))
}
function pdfUrl(c) {
  const d = docs.value[c.d]
  return `${base}${d.pdf}#page=${c.pdfPage}`
}
function citation(c) {
  const d = docs.value[c.d]
  return `${d.title}, ${d.edition} – ${c.label}${c.section ? `, ${c.section}` : ''} (${c.chapter}), page ${c.page}`
}
async function copy(c) {
  const text = `${c.text}\n\n— ${citation(c)}`
  try {
    await navigator.clipboard.writeText(text)
    snackbar.value = 'Rule text copied'
  } catch {
    snackbar.value = 'Copy not available'
  }
}
async function share() {
  try {
    if (navigator.share) await navigator.share({ title: 'IPSC Rulebooks Finder', url: location.href })
    else {
      await navigator.clipboard.writeText(location.href)
      snackbar.value = 'Link copied'
    }
  } catch {}
}
/** Back to the start page: empty search, default discipline. */
function goHome() {
  query.value = ''
  discipline.value = 'handgun'
  about.value = false
  run()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
function toggleTheme() {
  const next = theme.global.current.value.dark ? 'light' : 'dark'
  theme.change(next)
  writePref('theme', next)
}
const savedTheme = readPref('theme', null)
if (savedTheme) theme.change(savedTheme)
</script>

<template>
  <v-app>
    <v-app-bar color="appbar" density="comfortable" flat class="appbar">
      <v-app-bar-title>
        <a :href="base" class="home-link" aria-label="IPSC Rules Finder – start page" @click.prevent="goHome">
          <span class="font-weight-black text-gold">IPSC</span>
          <span class="font-weight-bold ml-1">Rules</span>
          <span class="ml-2 d-none d-sm-inline" style="opacity: 0.7">Finder</span>
        </a>
      </v-app-bar-title>
      <template #append>
        <v-btn :icon="mdiShareVariant" variant="text" aria-label="Share this search" @click="share" />
        <v-btn :icon="mdiThemeLightDark" variant="text" aria-label="Toggle dark mode" @click="toggleTheme" />
        <v-btn :icon="mdiInformationOutline" variant="text" aria-label="About" @click="about = true" />
      </template>
    </v-app-bar>

    <v-main>
      <v-container class="page">
        <v-img
          :src="`${base}banner.webp`"
          alt="IPSC Rulebooks Finder"
          :aspect-ratio="2000 / 750"
          class="banner mt-2"
          rounded="lg"
          eager
        />

        <v-text-field
          v-model="query"
          :prepend-inner-icon="mdiMagnify"
          placeholder="Ask a rules question, e.g. max magazine length in Optics"
          variant="solo"
          rounded="xl"
          clearable
          autofocus
          hide-details
          class="mt-4"
          :loading="status.index === 'loading'"
          @keydown.enter="run"
        />

        <v-chip-group v-model="discipline" mandatory column selected-class="text-primary" class="mt-2">
          <v-chip v-for="d in DISCIPLINES" :key="d.id" :value="d.id" filter variant="outlined">{{ d.label }}</v-chip>
        </v-chip-group>

        <div class="d-flex align-center flex-wrap ga-2 text-caption text-medium-emphasis mb-2">
          <span v-if="editionLine">Rulebook: {{ editionLine }}</span>
          <v-spacer />
          <v-tooltip location="bottom" max-width="320">
            <template #activator="{ props }">
              <span v-bind="props" class="d-inline-flex align-center ga-1">
                <template v-if="!smart">Keyword search</template>
                <template v-else-if="status.model === 'ready'">
                  <v-icon :icon="mdiCheckCircle" size="14" color="primary" /> Smart search ready
                </template>
                <template v-else-if="status.model === 'error'">
                  <v-icon :icon="mdiAlertCircleOutline" size="14" color="error" /> Smart search unavailable
                </template>
                <template v-else>
                  <v-progress-circular :model-value="status.progress" size="14" width="2" color="primary" />
                  Loading smart search…
                </template>
              </span>
            </template>
            Keyword search works instantly. Smart search also understands questions phrased differently from the
            rulebook. It runs entirely on your device; the model (~45 MB) downloads once and is then cached.
          </v-tooltip>
          <v-switch v-model="smart" :true-icon="mdiBrain" density="compact" hide-details color="primary" inset aria-label="Smart search" />
        </div>

        <!-- Empty state -->
        <div v-if="!searched" class="mt-6">
          <div class="text-subtitle-2 mb-2 text-medium-emphasis">Try for example</div>
          <div class="d-flex flex-wrap ga-2">
            <v-chip v-for="q in EXAMPLES" :key="q" variant="tonal" @click="example(q)">{{ q }}</v-chip>
          </div>
        </div>

        <!-- Results -->
        <template v-else>
          <div class="text-body-2 text-medium-emphasis my-2">
            <template v-if="results.length">
              {{ results.length }} matching rule{{ results.length === 1 ? '' : 's' }}
              <span v-if="divisions.length"> · Division: <strong class="text-capitalize">{{ divisions.join(', ') }}</strong></span>
              <span v-if="smart && !hybrid && status.model !== 'error'"> · refining…</span>
            </template>
            <template v-else>No matching rules found. Try other words, or select "All".</template>
          </div>

          <v-card v-for="r in results" :key="r.chunk.id" class="mb-3 result" rounded="lg" variant="elevated" elevation="1">
            <v-card-item class="pb-1">
              <div class="d-flex align-center flex-wrap ga-2">
                <v-chip v-if="discipline === 'all'" size="small" color="primary" variant="flat" label>
                  {{ docs[r.chunk.d].name }}
                </v-chip>
                <span class="text-subtitle-1 font-weight-bold">{{ r.chunk.label }}</span>
                <span v-if="r.chunk.title && r.chunk.kind !== 'definition'" class="text-subtitle-1">· {{ r.chunk.title }}</span>
              </div>
              <div class="text-caption text-medium-emphasis mt-1">
                {{ r.chunk.chapter }}<template v-if="r.chunk.section"> › {{ r.chunk.section }}</template>
              </div>
            </v-card-item>

            <v-card-text class="pt-1">
              <div v-if="r.chunk.kind !== 'definition' && parentOf(r.chunk)" class="parent text-body-2 mb-2">
                <span class="font-weight-medium">{{ parentOf(r.chunk).label }}:</span>
                {{ parentOf(r.chunk).text.length > 260 ? parentOf(r.chunk).text.slice(0, 260) + '…' : parentOf(r.chunk).text }}
              </div>
              <div class="rule-text text-body-1" v-html="highlight(r.chunk.text, re, divisions)" />

              <v-expand-transition>
                <div v-if="expanded[r.chunk.id]" class="mt-3">
                  <div v-for="n in neighbours(r.chunk)" :key="n.id" class="neighbour text-body-2 mb-2">
                    <span class="font-weight-medium">{{ n.label }}</span>
                    <span v-if="n.title && n.kind !== 'definition'"> · {{ n.title }}</span><br />
                    <span v-html="highlight(n.text, re, divisions)" />
                  </div>
                </div>
              </v-expand-transition>
            </v-card-text>

            <v-divider />
            <v-card-actions class="flex-wrap">
              <span class="text-caption text-medium-emphasis px-2">
                {{ docs[r.chunk.d].name }} Rules · {{ docs[r.chunk.d].edition }} · Page {{ r.chunk.page }}
              </span>
              <v-spacer />
              <v-btn size="small" variant="text" :prepend-icon="expanded[r.chunk.id] ? mdiChevronUp : mdiChevronDown"
                @click="expanded[r.chunk.id] = !expanded[r.chunk.id]">Context</v-btn>
              <v-btn size="small" variant="text" :prepend-icon="mdiContentCopy" @click="copy(r.chunk)">Copy</v-btn>
              <v-btn size="small" variant="tonal" color="primary" :prepend-icon="mdiFilePdfBox" :href="pdfUrl(r.chunk)"
                target="_blank" rel="noopener">PDF p. {{ r.chunk.page }}</v-btn>
            </v-card-actions>
          </v-card>
        </template>

        <p class="text-caption text-medium-emphasis text-center my-8">
          Unofficial search tool. Always verify rulings in the official IPSC rulebook.
          Rulebooks © International Practical Shooting Confederation.
        </p>
      </v-container>
    </v-main>

    <v-dialog v-model="about" max-width="560">
      <v-card title="About IPSC Rulebooks Finder" rounded="lg">
        <v-card-text>
          <p class="mb-3">
            Search the official English IPSC rulebooks. Every result shows the discipline, edition, chapter,
            section, rule number and page, with a link to that page in the PDF.
          </p>
          <v-table density="compact" class="mb-3">
            <tbody>
              <tr v-for="d in Object.values(docs)" :key="d.id">
                <td>{{ d.title }}</td>
                <td>{{ d.edition }}</td>
                <td><a :href="`${base}${d.pdf}`" target="_blank" rel="noopener">PDF</a></td>
              </tr>
            </tbody>
          </v-table>
          <p class="mb-3">
            Everything runs in your browser: no server, no tracking, no AI service. Keyword search works
            right away. Smart search (a small language model running on your device) also finds rules for
            differently worded questions.
          </p>
          <p class="text-medium-emphasis">
            This is not an official IPSC product. Rule interpretations published by IPSC are not included. If in
            doubt, the official rulebook and the Range Master's decision prevail.
          </p>
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn @click="about = false">Close</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar :model-value="!!snackbar" timeout="2000" @update:model-value="snackbar = ''">{{ snackbar }}</v-snackbar>
  </v-app>
</template>

<style>
.page {
  max-width: 860px;
}
.home-link {
  color: inherit;
  text-decoration: none;
  cursor: pointer;
}
.appbar {
  border-bottom: 2px solid rgb(var(--v-theme-gold)) !important;
}
.banner {
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
}
.rule-text mark,
.neighbour mark {
  background: rgba(var(--v-theme-primary), 0.18);
  color: inherit;
  border-radius: 3px;
  padding: 0 2px;
}
.rule-text strong.cell,
.neighbour strong.cell {
  background: rgba(var(--v-theme-primary), 0.12);
  outline: 1px solid rgba(var(--v-theme-primary), 0.5);
  border-radius: 3px;
  padding: 0 3px;
}
.parent {
  border-left: 3px solid rgba(var(--v-theme-primary), 0.5);
  padding-left: 10px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.neighbour {
  border-left: 3px solid rgba(var(--v-theme-on-surface), 0.15);
  padding-left: 10px;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.rule-text {
  line-height: 1.55;
}
</style>
