# Discord Bot Generator using AI

**BotForge** — describe a Discord bot in plain language, pick its skills, feed it a
knowledge base, then download a complete `discord.js` v14 project that thinks,
brainstorms, and answers from your documents with citations.

The generator hands you source code. Nothing keeps running on this side after you
download the ZIP, and the generated bot has no dependency on this project.

## What it produces

A standalone Node project:

```
atlas/
├── index.js              gateway wiring, command dispatch, event fan-out
├── deploy-commands.js    slash command registration (guild or global)
├── src/core/
│   ├── config.js         your blueprint, frozen into constants
│   ├── brain.js          every model call — persona, think, ideas, summarise
│   ├── rag.js            hybrid retriever (BM25 + optional embeddings)
│   ├── memory.js         rolling per-channel conversation memory
│   ├── store.js          JSON file persistence
│   └── discord.js        message chunking / reply helpers
├── src/skills/           one readable file per enabled skill
├── knowledge/            markdown documents, chunked and indexed at boot
└── README.md             setup, Discord portal checklist, how to extend
```

## The mind

What separates this from a command scaffold:

- **Think mode** — reasons at higher effort with adaptive thinking before
  answering, and posts a short summary of how it got there.
- **Idea engine** — divergent brainstorming that produces genuinely distinct
  directions, then develops whichever one you pick.
- **Knowledge recall (RAG)** — documents are chunked on paragraph boundaries and
  indexed at boot. Retrieval is BM25 by default; add a `VOYAGE_API_KEY` and it
  blends in semantic search so paraphrases match too. Answers cite `[1]`, `[2]`.
- **Memory** — the last N turns per channel, so follow-up questions land.
- **Live persona** — admins can retune the bot's voice at runtime, per server.

Documents can also be taught at runtime with `/learn`, no redeploy.

## Skill library

13 skills across four groups. Enabling one emits its file and wires the gateway
intents and default permissions it needs.

| Group | Skills |
| --- | --- |
| Mind | AI Conversation, Knowledge Base (RAG), Think Mode, Idea Engine, Catch Me Up, Live Persona |
| Community | Welcome Committee, Polls, Activity Levels |
| Utility | Reminders, Support Threads, Translate |
| Moderation | Moderation (purge / timeout / warn, with audit log) |

## Running this app

```bash
npm install
cp .env.example .env.local     # optional — add ANTHROPIC_API_KEY
npm run dev                    # http://localhost:3000
```

Then open `/builder`.

### Without an API key

The studio is fully usable offline. Blueprints come from keyword matching
instead of Claude, and the playground returns a notice rather than a model
reply — but **retrieval still runs for real**, and composing skills, inspecting
every generated file and downloading the ZIP all work normally. The header tells
you which mode you are in.

With `ANTHROPIC_API_KEY` set, Claude (`claude-opus-5`) drafts the blueprint via
structured outputs and the playground answers over your documents.

## How it fits together

| Path | Role |
| --- | --- |
| `src/lib/blueprint.ts` | The blueprint schema — single source of truth, Zod-validated at every boundary |
| `src/lib/skills.ts` | Skill catalog: metadata plus the code each skill emits |
| `src/lib/rag.ts` | BM25 retriever used by the playground |
| `src/lib/codegen/` | Turns a blueprint into the file list that becomes the ZIP |
| `src/lib/ai.ts` | Claude calls, each with a deterministic offline fallback |
| `src/app/api/*` | `generate` (draft), `chat` (playground), `preview` (file tree), `export` (ZIP) |

The playground and the generated bot run the *same* retrieval algorithm, so a
question that works in the studio works in the shipped bot.

## Verification

`npm run build` and `npm run typecheck` both pass. The generated output was
checked by exporting projects across three configurations — all 13 skills, a
namespaced build, and a minimal single-skill build — and then, in the generated
project:

- every emitted `.js` file parses under `node --check`;
- all 21 commands pass `discord.js`'s own builder validation via `data.toJSON()`,
  with no duplicate names and Discord-legal names under a namespace;
- retrieval, `/learn` → `/forget` round trips, persona override/reset and message
  chunking behave correctly;
- `index.js` was loaded against a stubbed gateway to confirm command dispatch,
  `messageCreate` fan-out, the `ready` → `clientReady` mapping, and that a
  throwing command surfaces to the user without killing the process;
- both entry points fail with a clear message when credentials are absent.

**Not verified:** live calls to the Anthropic and Voyage APIs. No credentials
were available in the build environment, so those request shapes are type-checked
against the SDK but have not returned a real 200.

## Cost note

Generated bots call the model on mind commands and on mentions — not on every
message. `MIND.effort` in `src/core/config.js` is the main dial.
