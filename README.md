# IPSC Rules Search

A small, free web app to search the official English IPSC rulebooks:
**Handgun, Shotgun, Rifle and Pistol Caliber Carbine** (January 2026 Edition).

Type a question such as *"What is the maximum magazine length in Optics Division?"*, pick a
discipline (Handgun is the default, or *All*), and get the matching rules. Every result shows the
discipline, edition, chapter, section, rule number and page, with a link to that page in the PDF.

## How it works

It is a static website with no server, no database and no AI service, so it costs nothing to run,
however many people use it. All searching happens in the visitor's browser:

- **Keyword search** (BM25 via [MiniSearch](https://github.com/lucaong/minisearch)) with a list of
  shooter slang and abbreviations (mag, DQ, PF, 180, red dot, …). Works instantly.
- **Smart search**: a small embedding model
  ([bge-small-en-v1.5](https://huggingface.co/Xenova/bge-small-en-v1.5), ~33 MB) runs on the device
  via [transformers.js](https://github.com/huggingface/transformers.js). It finds rules for questions
  phrased differently from the rulebook. It downloads once, is then cached, and can be switched off.
- Both result lists are merged. Division names in the question (Optics, Production, SG Open, PCC
  Iron, …) boost that Division's appendix and highlight its column in the Division tables.
- It is an installable PWA, so it works offline on the range after the first visit.

The rulebooks are converted ahead of time into ~2,800 "chunks": one per numbered rule, per
Division-table row, and per glossary term. These are stored in `public/data/index.json` together
with their embeddings (`public/data/vectors.bin`).

```
public/pdf/*.pdf ──parse_rulebooks.py──► data/chunks.json ──embed.mjs──► public/data/{index.json,vectors.bin}
                                                                                   │
                                                          Vue + Vuetify app (src/) ◄┘
```

## Development

Requires Node 22+ and Python 3.11+.

```bash
npm install            # also copies the ONNX runtime into public/ort
npm run fetch-model    # downloads the embedding model into public/models
npm run dev            # http://localhost:5173
```

## Updating to a new rulebook edition

1. Download the new English PDFs from <https://www.ipsc.org/ipsc-rules/rule-books/> and replace
   `public/pdf/handgun.pdf`, `shotgun.pdf`, `rifle.pdf`, `pcc.pdf`.
2. Rebuild the index and check search quality:
   ```bash
   python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
   .venv/bin/python scripts/parse_rulebooks.py
   npm run embed
   npm run eval            # test questions with known answers; fix any failures
   ```
   The edition (e.g. "January 2026 Edition") is read from page 1 of each PDF automatically.
   Rule numbers can move between editions, so some expected IDs in `scripts/eval.mjs` may need updating.
3. Commit and push. GitHub Actions builds and deploys the site.

To try your own question against the index: `npm run eval -- "your question" handgun`.

## Deployment (GitHub Pages)

`.github/workflows/deploy.yml` builds and publishes the site on every push to `main`.
One-time setup: in the repository go to **Settings → Pages → Build and deployment** and set
**Source** to **GitHub Actions**. The site is then served at `https://<user>.github.io/ipsc-rules/`.

## Disclaimer

This is not an official IPSC product. The rulebooks are © International Practical Shooting
Confederation and are included unchanged so results can link to the exact page. Always verify
rulings in the official rulebook. IPSC rules interpretations are not included.
