import type { Blueprint } from "../blueprint";
import { getSkills } from "../skills";

/**
 * Runtime files for the generated bot: config, logging, storage, Discord
 * helpers, the retriever, memory and the brain.
 */

export function configFile(blueprint: Blueprint): string {
  return `// Generated from your blueprint. Safe to edit — nothing regenerates this file.

module.exports = {
  BOT_NAME: ${JSON.stringify(blueprint.name)},
  TAGLINE: ${JSON.stringify(blueprint.tagline)},
  ACCENT: ${JSON.stringify(blueprint.accent)},
  PERSONA: ${JSON.stringify(blueprint.persona)},
  MODEL: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
  MIND: ${JSON.stringify(blueprint.mind, null, 2).replace(/\n/g, "\n  ")},
  SKILLS: ${JSON.stringify(blueprint.skills)},
};
`;
}

export const LOG_FILE = `const stamp = () => new Date().toISOString().slice(11, 19);

const write = (level, colour, args) =>
  console.log(colour + '[' + stamp() + '] ' + level + '\\x1b[0m', ...args);

module.exports = {
  info: (...args) => write('info ', '\\x1b[36m', args),
  warn: (...args) => write('warn ', '\\x1b[33m', args),
  error: (...args) => write('error', '\\x1b[31m', args),
  ok: (...args) => write('ok   ', '\\x1b[32m', args),
};
`;

export const STORE_FILE = `const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'data');

/**
 * Tiny JSON-file store. Synchronous on purpose: the payloads are small and it
 * removes any chance of a half-written state on restart. Swap for a real
 * database if you outgrow it — every caller goes through read()/write().
 */
function store(name, fallback) {
  const file = path.join(DIR, name + '.json');

  const read = () => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return structuredClone(fallback);
    }
  };

  const write = (value) => {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  };

  return { read, write, file };
}

module.exports = { store };
`;

export const DISCORD_HELPERS_FILE = `const LIMIT = 1900;

/** Splits text on paragraph then line boundaries so replies never exceed Discord's cap. */
function chunk(text, limit = LIMIT) {
  const clean = String(text ?? '').trim() || '(no content)';
  if (clean.length <= limit) return [clean];

  const parts = [];
  let current = '';

  for (const block of clean.split('\\n')) {
    if (current.length + block.length + 1 > limit) {
      if (current) parts.push(current);
      if (block.length > limit) {
        for (let i = 0; i < block.length; i += limit) parts.push(block.slice(i, i + limit));
        current = '';
        continue;
      }
      current = block;
    } else {
      current = current ? current + '\\n' + block : block;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** Replies to a deferred interaction, following up with overflow. */
async function reply(interaction, text) {
  const parts = chunk(text);
  await interaction.editReply(parts[0]);
  for (const part of parts.slice(1)) await interaction.followUp(part);
}

module.exports = { chunk, reply, LIMIT };
`;

export const RAG_FILE = `const fs = require('fs');
const path = require('path');
const log = require('./log');

const KNOWLEDGE_DIR = path.join(__dirname, '..', '..', 'knowledge');

/**
 * Hybrid retrieval over knowledge/*.md.
 *
 * BM25 always runs. When VOYAGE_API_KEY is set, chunks are also embedded at
 * boot and the two scores are blended — semantic recall catches paraphrases
 * that keyword matching misses, and lexical scoring keeps exact terms (error
 * codes, product names) from being washed out. No key means no embeddings and
 * no crash: the retriever just runs lexical-only.
 */

const STOPWORDS = new Set(
  'a an the and or but if then than that this these those is are was were be been being of to in on at by for with from as it its into about over under not no do does did doing have has had i you he she they we me my your our their there here what which who whom when where why how all any both each few more most other some such only own same so too very can will just don should now'.split(
    ' ',
  ),
);

const tokenize = (input) =>
  String(input)
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}\\s]/gu, ' ')
    .split(/\\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));

function chunkText(text, target = 900) {
  const paragraphs = text
    .split(/\\n\\s*\\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > target) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? current + '\\n\\n' + paragraph : paragraph;
    }
  }
  if (current) chunks.push(current);

  return chunks.flatMap((piece) => {
    if (piece.length <= target * 2) return [piece];
    const parts = [];
    for (let i = 0; i < piece.length; i += target) parts.push(piece.slice(i, i + target));
    return parts;
  });
}

const slug = (title) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'note';

class Retriever {
  constructor() {
    this.chunks = [];
    this.embeddings = null;
  }

  load() {
    fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
    const files = fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.md'));

    this.chunks = [];
    for (const file of files) {
      const raw = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), 'utf8');
      // First '# Heading' wins as the title; otherwise fall back to the filename.
      const heading = raw.match(/^#\\s+(.+)$/m);
      const title = heading ? heading[1].trim() : path.basename(file, '.md');
      const body = raw.replace(/^#\\s+.+$/m, '').trim();

      chunkText(body).forEach((text, index) => {
        this.chunks.push({ file, title, text, index });
      });
    }

    log.info('[rag] ' + this.chunks.length + ' chunk(s) from ' + files.length + ' document(s)');
    this.embeddings = null;
    return this.chunks.length;
  }

  bm25(query, limit) {
    if (!this.chunks.length) return [];
    const queryTerms = tokenize(query);
    if (!queryTerms.length) return [];

    const docTokens = this.chunks.map((c) => tokenize(c.title + ' ' + c.text));
    const avgLength = docTokens.reduce((sum, t) => sum + t.length, 0) / docTokens.length;

    const df = new Map();
    for (const term of new Set(queryTerms)) {
      df.set(term, docTokens.filter((tokens) => tokens.includes(term)).length);
    }

    const k1 = 1.5;
    const b = 0.75;

    const scored = this.chunks.map((chunk, i) => {
      const tokens = docTokens[i];
      const counts = new Map();
      for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

      let score = 0;
      for (const term of queryTerms) {
        const tf = counts.get(term) ?? 0;
        if (!tf) continue;
        const n = df.get(term) ?? 0;
        const idf = Math.log(1 + (this.chunks.length - n + 0.5) / (n + 0.5));
        score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (tokens.length / avgLength))));
      }

      const titleTokens = new Set(tokenize(chunk.title));
      score += queryTerms.filter((t) => titleTokens.has(t)).length * 0.6;

      return { index: i, score };
    });

    return scored.filter((s) => s.score > 0).sort((a, b2) => b2.score - a.score).slice(0, limit);
  }

  async embed(texts) {
    const key = process.env.VOYAGE_API_KEY;
    if (!key) return null;

    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: process.env.VOYAGE_MODEL || 'voyage-3.5',
        input: texts,
        input_type: 'document',
      }),
    });

    if (!response.ok) throw new Error('voyage ' + response.status + ': ' + (await response.text()).slice(0, 200));
    const payload = await response.json();
    return payload.data.map((d) => d.embedding);
  }

  async ensureEmbeddings() {
    if (!process.env.VOYAGE_API_KEY || this.embeddings || !this.chunks.length) return;
    try {
      this.embeddings = await this.embed(this.chunks.map((c) => c.title + '\\n' + c.text));
      log.ok('[rag] embedded ' + this.embeddings.length + ' chunk(s)');
    } catch (error) {
      log.warn('[rag] embeddings unavailable, staying lexical — ' + error.message);
      this.embeddings = null;
    }
  }

  async semantic(query, limit) {
    await this.ensureEmbeddings();
    if (!this.embeddings) return [];

    let queryVector;
    try {
      const vectors = await this.embed([query]);
      queryVector = vectors?.[0];
    } catch (error) {
      log.warn('[rag] query embedding failed — ' + error.message);
      return [];
    }
    if (!queryVector) return [];

    const cosine = (a, b) => {
      let dot = 0;
      let na = 0;
      let nb = 0;
      for (let i = 0; i < a.length; i += 1) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
      }
      return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
    };

    return this.embeddings
      .map((vector, index) => ({ index, score: cosine(queryVector, vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** Blends both rankings, normalised so neither signal dominates by scale. */
  async search(query, limit = 4) {
    const pool = Math.max(limit * 3, 8);
    const [lexical, semantic] = await Promise.all([
      Promise.resolve(this.bm25(query, pool)),
      this.semantic(query, pool),
    ]);

    const normalise = (list) => {
      const top = list[0]?.score ?? 0;
      return new Map(list.map((entry) => [entry.index, top > 0 ? entry.score / top : 0]));
    };

    const lex = normalise(lexical);
    const sem = normalise(semantic);
    const weight = sem.size ? 0.5 : 1;

    const combined = new Map();
    for (const [index, score] of lex) combined.set(index, score * weight);
    for (const [index, score] of sem) combined.set(index, (combined.get(index) ?? 0) + score * 0.5);

    return [...combined.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([index, score]) => {
        const chunk = this.chunks[index];
        return {
          title: chunk.title,
          text: chunk.text,
          file: chunk.file,
          score,
          excerpt: chunk.text.replace(/\\s+/g, ' ').slice(0, 160),
        };
      });
  }

  /** Citable context block for the model, or empty string when nothing matches. */
  async context(query, limit = 4) {
    const hits = await this.search(query, limit);
    if (!hits.length) return { text: '', hits: [] };
    return {
      text: hits.map((hit, i) => '[' + (i + 1) + '] ' + hit.title + '\\n' + hit.text).join('\\n\\n---\\n\\n'),
      hits,
    };
  }

  async learn({ title, content, author }) {
    fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
    const file = path.join(KNOWLEDGE_DIR, slug(title) + '.md');
    const header = '# ' + title + '\\n\\n';
    const footer = '\\n\\n<!-- learned from ' + (author || 'unknown') + ' at ' + new Date().toISOString() + ' -->\\n';
    fs.writeFileSync(file, header + content.trim() + footer);

    const added = chunkText(content).length;
    this.load();
    return { chunks: added, file: path.basename(file) };
  }

  forget(title) {
    const file = path.join(KNOWLEDGE_DIR, slug(title) + '.md');
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    this.load();
    return true;
  }
}

module.exports = { Retriever };
`;

export const MEMORY_FILE = `const { store } = require('./store');

const TURNS = Number(process.env.MEMORY_TURNS || 12);
const memory = store('memory', {});

/**
 * Rolling per-channel conversation memory, trimmed to the last N turns so the
 * prompt stays bounded and cache-friendly.
 */
module.exports = {
  history(channelId) {
    return memory.read()[channelId] ?? [];
  },

  append(channelId, role, content) {
    const all = memory.read();
    const turns = all[channelId] ?? [];
    turns.push({ role, content: String(content).slice(0, 4000) });
    all[channelId] = turns.slice(-TURNS);
    memory.write(all);
  },

  clear(channelId) {
    const all = memory.read();
    delete all[channelId];
    memory.write(all);
  },
};
`;

export function brainFile(blueprint: Blueprint): string {
  const skills = getSkills(blueprint.skills);
  const needsIdeas = skills.some((s) => s.id === "idea-engine");

  return `const Anthropic = require('@anthropic-ai/sdk');
const { PERSONA, MODEL, MIND, BOT_NAME } = require('./config');
const { store } = require('./store');
const memory = require('./memory');
const log = require('./log');

const personas = store('personas', {});

/**
 * Every model call in the bot goes through here.
 *
 * Prompt layout is deliberate: the persona is stable and comes first so it
 * caches, retrieved context and the live question come last. See
 * https://platform.claude.com/docs/en/build-with-claude/prompt-caching
 */
class Brain {
  constructor(retriever) {
    this.retriever = retriever;
    this.client = process.env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null;
    if (!this.client) log.warn('[brain] ANTHROPIC_API_KEY is not set — model calls will return a notice');
  }

  getPersona(guildId) {
    return personas.read()[guildId] || PERSONA;
  }

  setPersona(guildId, persona) {
    const all = personas.read();
    if (persona === null) delete all[guildId];
    else all[guildId] = persona;
    personas.write(all);
  }

  text(message) {
    return message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\\n')
      .trim();
  }

  thinking(message) {
    return message.content
      .filter((block) => block.type === 'thinking')
      .map((block) => block.thinking)
      .join('\\n')
      .trim();
  }

  /** Single-shot call with an explicit system prompt. */
  async raw({ system, user, effort = MIND.effort, think = false, maxTokens = 4096, history = [] }) {
    if (!this.client) {
      return { text: BOT_NAME + ' has no ANTHROPIC_API_KEY configured, so I cannot answer yet.', reasoning: '' };
    }

    try {
      const message = await this.client.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        thinking: think ? { type: 'adaptive', display: 'summarized' } : { type: 'adaptive' },
        output_config: { effort },
        messages: [...history, { role: 'user', content: user }],
      });

      return { text: this.text(message) || '(empty reply)', reasoning: this.thinking(message) };
    } catch (error) {
      log.error('[brain] ' + error.message);
      return { text: 'Something went wrong reaching the model: ' + error.message, reasoning: '' };
    }
  }

  systemFor(guildId, extras = []) {
    const parts = [this.getPersona(guildId)];
    for (const extra of extras) if (extra) parts.push(extra);
    parts.push('You are writing a Discord message. Stay under 1500 characters and avoid markdown headers.');
    return parts.join('\\n\\n');
  }

  async answer({ question, channelId, guildId, groundedOnly = false }) {
    const extras = [];

    if (MIND.recall || groundedOnly) {
      const { text } = await this.retriever.context(question);
      if (text) {
        extras.push('Knowledge base excerpts. Cite them inline as [1], [2] when you use them:\\n\\n' + text);
      } else if (groundedOnly) {
        return 'I have nothing in the knowledge base about that. Teach me with /learn and ask again.';
      } else {
        extras.push('The knowledge base returned nothing relevant. Do not invent server-specific facts.');
      }
    }

    if (groundedOnly) {
      extras.push('Answer only from the excerpts above. If they do not cover it, say so plainly.');
    }

    const history = MIND.memory ? memory.history(channelId) : [];
    const { text } = await this.raw({
      system: this.systemFor(guildId, extras),
      user: question,
      history,
    });

    if (MIND.memory) {
      memory.append(channelId, 'user', question);
      memory.append(channelId, 'assistant', text);
    }

    return text;
  }

  async think({ problem, channelId, guildId }) {
    const { text } = await this.retriever.context(problem);
    const extras = [
      text ? 'Relevant knowledge base excerpts:\\n\\n' + text : '',
      'Work through this carefully before answering. Lead with the answer, then a short "How I got there" of at most three sentences.',
    ];

    const result = await this.raw({
      system: this.systemFor(guildId, extras),
      user: problem,
      effort: MIND.effort === 'low' ? 'high' : MIND.effort,
      think: true,
      maxTokens: 8000,
      history: MIND.memory ? memory.history(channelId) : [],
    });

    return { answer: result.text, reasoning: result.reasoning };
  }
${
  needsIdeas
    ? `
  async ideas({ topic, count = 5, guildId }) {
    const { text } = await this.retriever.context(topic);
    const system = this.systemFor(guildId, [
      text ? 'Context from the knowledge base:\\n\\n' + text : '',
      'Generate ' +
        count +
        ' genuinely different directions — different angles, not variations on one. Return JSON only: {"ideas":[{"title":"...","detail":"..."}]}. Each detail is at most two sentences.',
    ]);

    const { text: raw } = await this.raw({ system, user: topic, maxTokens: 4096 });

    // The model is asked for JSON; degrade to a single idea rather than throwing.
    try {
      const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed.ideas) && parsed.ideas.length) return parsed.ideas;
    } catch {
      log.warn('[brain] idea JSON did not parse, returning raw text');
    }
    return [{ title: 'Directions', detail: raw.slice(0, 1000) }];
  }

  async expand({ idea, channelId, guildId }) {
    const { text } = await this.raw({
      system: this.systemFor(guildId, [
        'Develop the idea into something concrete: what it is, the first three steps to try it, and the most likely reason it fails.',
      ]),
      user: idea,
      effort: MIND.effort,
      maxTokens: 4096,
      history: MIND.memory ? memory.history(channelId) : [],
    });
    return text;
  }
`
    : ""
}
  async summarize({ transcript, guildId }) {
    const { text } = await this.raw({
      system: this.systemFor(guildId, [
        'Summarise the conversation for someone who was away. Cover: what was decided, what is still open, and who is waiting on whom. Use short bullets. Skip small talk.',
      ]),
      user: transcript.slice(-12000),
      effort: 'medium',
      maxTokens: 2048,
    });
    return text;
  }

  async welcome({ username, guildName }) {
    const { text: context } = await this.retriever.context('server rules introduction getting started');
    const { text } = await this.raw({
      system: this.systemFor(null, [
        context ? 'What this server is about:\\n\\n' + context : '',
        'Write a two-sentence welcome for a new member. Warm, specific, no exclamation-mark spam. If the context above says where to start, point them there.',
      ]),
      user: 'New member ' + username + ' just joined ' + guildName + '.',
      effort: 'low',
      maxTokens: 512,
    });
    return text;
  }
}

module.exports = { Brain };
`;
}
