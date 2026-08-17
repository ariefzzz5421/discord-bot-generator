import type { KnowledgeDoc } from "./blueprint";

/**
 * Lexical retrieval (BM25) over the knowledge base.
 *
 * This is deliberately dependency-free: it runs identically in the web
 * playground and in the generated bot, so what the user tests here is what
 * they ship. The generated bot layers optional embeddings on top of the same
 * scores — see the retriever it emits.
 */

export interface Chunk {
  docId: string;
  title: string;
  text: string;
  index: number;
}

export interface Hit extends Chunk {
  score: number;
}

const STOPWORDS = new Set(
  "a an the and or but if then than that this these those is are was were be been being of to in on at by for with from as it its into about over under not no do does did doing have has had i you he she they we me my your our their there here what which who whom when where why how all any both each few more most other some such only own same so too very can will just don should now".split(
    " ",
  ),
);

export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Split on blank lines, then pack paragraphs up to a target size so a chunk is
 * a coherent passage rather than an arbitrary window.
 */
export function chunkText(text: string, target = 900): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > target) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);

  // A single paragraph longer than the target still needs splitting.
  return chunks.flatMap((chunk) => {
    if (chunk.length <= target * 2) return [chunk];
    const parts: string[] = [];
    for (let i = 0; i < chunk.length; i += target) parts.push(chunk.slice(i, i + target));
    return parts;
  });
}

export function buildChunks(docs: KnowledgeDoc[]): Chunk[] {
  return docs.flatMap((doc) =>
    chunkText(doc.content).map((text, index) => ({
      docId: doc.id,
      title: doc.title,
      text,
      index,
    })),
  );
}

const K1 = 1.5;
const B = 0.75;

export function search(query: string, chunks: Chunk[], limit = 4): Hit[] {
  if (!chunks.length) return [];

  const queryTerms = tokenize(query);
  if (!queryTerms.length) return [];

  const docTokens = chunks.map((c) => tokenize(`${c.title} ${c.text}`));
  const avgLength = docTokens.reduce((sum, t) => sum + t.length, 0) / docTokens.length;

  // Document frequency per query term.
  const df = new Map<string, number>();
  for (const term of new Set(queryTerms)) {
    df.set(term, docTokens.filter((tokens) => tokens.includes(term)).length);
  }

  const scored = chunks.map((chunk, i) => {
    const tokens = docTokens[i];
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

    let score = 0;
    for (const term of queryTerms) {
      const tf = counts.get(term) ?? 0;
      if (!tf) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (chunks.length - n + 0.5) / (n + 0.5));
      const norm = tf * (K1 + 1);
      const denom = tf + K1 * (1 - B + B * (tokens.length / avgLength));
      score += idf * (norm / denom);
    }

    // Small nudge for a title match — titles are written to be searched.
    const titleTokens = new Set(tokenize(chunk.title));
    const titleOverlap = queryTerms.filter((t) => titleTokens.has(t)).length;
    score += titleOverlap * 0.6;

    return { ...chunk, score };
  });

  return scored
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Renders hits as a citable context block for the model. */
export function formatContext(hits: Hit[]): string {
  return hits
    .map((hit, i) => `[${i + 1}] ${hit.title}\n${hit.text}`)
    .join("\n\n---\n\n");
}

export function excerpt(text: string, length = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > length ? `${clean.slice(0, length)}…` : clean;
}
