// Shared between the build scripts and the browser app (src/search/config.js re-exports it).
export const MODEL_ID = 'Xenova/bge-small-en-v1.5'
// bge models expect this instruction in front of search queries (not in front of passages).
export const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '
export const DIM = 384
