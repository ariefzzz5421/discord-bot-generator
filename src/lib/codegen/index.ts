import type { Blueprint } from "../blueprint";
import { slugify } from "../blueprint";
import { getSkills, skillContext } from "../skills";
import {
  brainFile,
  configFile,
  DISCORD_HELPERS_FILE,
  LOG_FILE,
  MEMORY_FILE,
  RAG_FILE,
  STORE_FILE,
} from "./core";

export interface GeneratedFile {
  path: string;
  content: string;
}

const BASE_INTENTS = ["Guilds"];

function intentsFor(blueprint: Blueprint): string[] {
  const intents = new Set(BASE_INTENTS);
  for (const skill of getSkills(blueprint.skills)) {
    for (const intent of skill.intents ?? []) intents.add(intent);
  }
  return [...intents];
}

function partialsFor(blueprint: Blueprint): string[] {
  const partials = new Set<string>();
  for (const skill of getSkills(blueprint.skills)) {
    for (const partial of skill.partials ?? []) partials.add(partial);
  }
  return [...partials];
}

function registryFile(blueprint: Blueprint): string {
  const skills = getSkills(blueprint.skills);
  return `// Enabled skills. Add a file in this directory and list it here to extend the bot.

module.exports = [
${skills.map((s) => `  require('./${s.id}'),`).join("\n")}
];
`;
}

function entryFile(blueprint: Blueprint): string {
  const intents = intentsFor(blueprint);
  const partials = partialsFor(blueprint);

  return `require('dotenv').config();

const { Client, GatewayIntentBits, Collection${partials.length ? ", Partials" : ""} } = require('discord.js');
const { BOT_NAME, TAGLINE } = require('./src/core/config');
const { Retriever } = require('./src/core/rag');
const { Brain } = require('./src/core/brain');
const log = require('./src/core/log');
const skills = require('./src/skills/registry');

if (!process.env.DISCORD_TOKEN) {
  log.error('DISCORD_TOKEN is missing. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const client = new Client({
  intents: [${intents.map((i) => `GatewayIntentBits.${i}`).join(", ")}],${
    partials.length ? `\n  partials: [${partials.map((p) => `Partials.${p}`).join(", ")}],` : ""
  }
});

// Shared context handed to every skill.
const retriever = new Retriever();
retriever.load();

const ctx = { retriever, rag: retriever, brain: new Brain(retriever), log };

// Slash commands, indexed by name.
client.commands = new Collection();
for (const skill of skills) {
  for (const command of skill.commands ?? []) {
    client.commands.set(command.data.name, command);
  }
}

client.once('clientReady', async () => {
  log.ok(BOT_NAME + ' online as ' + client.user.tag);
  log.info(TAGLINE);
  log.info(client.commands.size + ' command(s), ' + skills.length + ' skill(s)');
  client.user.setActivity(TAGLINE.slice(0, 120));

  // Warm the embedding cache so the first question is not the slow one.
  await retriever.ensureEmbeddings().catch(() => {});
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, ctx);
  } catch (error) {
    log.error('[' + interaction.commandName + '] ' + error.stack);
    const notice = { content: 'That command failed: ' + error.message, ephemeral: true };
    // The command may or may not have deferred before throwing.
    if (interaction.deferred || interaction.replied) await interaction.followUp(notice).catch(() => {});
    else await interaction.reply(notice).catch(() => {});
  }
});

// Skill event handlers, grouped so one failure cannot take down the others.
const handlers = new Map();
for (const skill of skills) {
  for (const event of skill.events ?? []) {
    if (!handlers.has(event.name)) handlers.set(event.name, []);
    handlers.get(event.name).push({ skill: skill.id, run: event.run });
  }
}

for (const [name, list] of handlers) {
  const wired = name === 'ready' ? 'clientReady' : name;
  client.on(wired, async (...args) => {
    for (const handler of list) {
      try {
        await handler.run(client, ctx, ...args);
      } catch (error) {
        log.error('[' + handler.skill + ':' + name + '] ' + error.message);
      }
    }
  });
}

process.on('unhandledRejection', (error) => log.error('unhandled rejection: ' + error));

client.login(process.env.DISCORD_TOKEN);
`;
}

function deployFile(blueprint: Blueprint): string {
  return `require('dotenv').config();

const { REST, Routes } = require('discord.js');
const skills = require('./src/skills/registry');
const log = require('./src/core/log');

/**
 * Registers slash commands with Discord. Run this after changing any command
 * definition — the bot itself does not register them on boot.
 *
 *   node deploy-commands.js            # guild scoped, instant (needs GUILD_ID)
 *   node deploy-commands.js --global   # every server, propagates in ~1 hour
 */
const commands = skills.flatMap((skill) => (skill.commands ?? []).map((c) => c.data.toJSON()));

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
const global = process.argv.includes('--global');

if (!DISCORD_TOKEN || !CLIENT_ID) {
  log.error('DISCORD_TOKEN and CLIENT_ID are both required in .env');
  process.exit(1);
}
if (!global && !GUILD_ID) {
  log.error('Set GUILD_ID for guild-scoped registration, or pass --global.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    const route = global
      ? Routes.applicationCommands(CLIENT_ID)
      : Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID);

    const data = await rest.put(route, { body: commands });
    log.ok('Registered ' + data.length + ' command(s) ' + (global ? 'globally' : 'to guild ' + GUILD_ID));
    for (const command of data) log.info('  /' + command.name);
  } catch (error) {
    log.error(error.stack);
    process.exit(1);
  }
})();
`;
}

function packageFile(blueprint: Blueprint): string {
  return `${JSON.stringify(
    {
      name: slugify(blueprint.name),
      version: "1.0.0",
      private: true,
      description: blueprint.tagline,
      main: "index.js",
      scripts: {
        start: "node index.js",
        deploy: "node deploy-commands.js",
        "deploy:global": "node deploy-commands.js --global",
      },
      dependencies: {
        "@anthropic-ai/sdk": "^0.117.1",
        "discord.js": "^14.18.0",
        dotenv: "^16.4.7",
      },
      engines: { node: ">=20" },
    },
    null,
    2,
  )}\n`;
}

function envFile(blueprint: Blueprint): string {
  const skills = getSkills(blueprint.skills);
  const lines = [
    "# --- Discord -------------------------------------------------------------",
    "# Bot token from https://discord.com/developers/applications -> Bot",
    "DISCORD_TOKEN=",
    "# Application ID from the same page -> General Information",
    "CLIENT_ID=",
    "# Your server id (enable Developer Mode, right-click the server, Copy Server ID)",
    "GUILD_ID=",
    "",
    "# --- Model ---------------------------------------------------------------",
    "ANTHROPIC_API_KEY=",
    "ANTHROPIC_MODEL=claude-opus-5",
    "",
    "# --- Retrieval (optional) -----------------------------------------------",
    "# Without this the retriever runs BM25 only, which is fine for small",
    "# knowledge bases. Add a key to blend in semantic search.",
    "VOYAGE_API_KEY=",
    "VOYAGE_MODEL=voyage-3.5",
    "",
    "# --- Behaviour -----------------------------------------------------------",
    "# Conversation turns kept per channel",
    "MEMORY_TURNS=12",
  ];

  if (skills.some((s) => s.id === "welcome")) {
    lines.push("", "# Channel name (not id) for welcome messages", "WELCOME_CHANNEL=general");
  }
  if (skills.some((s) => s.id === "moderation")) {
    lines.push("", "# Channel name for the moderation audit log; leave blank to disable", "MOD_LOG_CHANNEL=mod-log");
  }

  return `${lines.join("\n")}\n`;
}

function readmeFile(blueprint: Blueprint): string {
  const skills = getSkills(blueprint.skills);
  const ctx = skillContext(blueprint);
  const intents = intentsFor(blueprint);

  const privileged = intents.filter((i) => ["MessageContent", "GuildMembers"].includes(i));

  return `# ${blueprint.name}

> ${blueprint.tagline}

Generated by **Discord Bot Generator using AI**. This is a complete, standalone
discord.js v14 project — no framework, no lock-in, nothing phones home.

## What it can do

| Skill | Commands |
| --- | --- |
${skills.map((s) => `| ${s.emoji} ${s.name} | ${s.commands.length ? s.commands.map((c) => `\`${c.replace("/", `/${blueprint.namespace ? `${blueprint.namespace}-` : ""}`)}\``).join(", ") : "_event-driven_"} |`).join("\n")}

Mind configuration: **think** ${blueprint.mind.think ? "on" : "off"} · **ideas** ${
    blueprint.mind.ideas ? "on" : "off"
  } · **recall** ${blueprint.mind.recall ? "on" : "off"} · **memory** ${
    blueprint.mind.memory ? "on" : "off"
  } · effort \`${blueprint.mind.effort}\`

## Setup

\`\`\`bash
npm install
cp .env.example .env      # then fill in DISCORD_TOKEN, CLIENT_ID, GUILD_ID, ANTHROPIC_API_KEY
npm run deploy            # register slash commands to your test server
npm start
\`\`\`

### Discord portal checklist

1. Create an application at <https://discord.com/developers/applications>.
2. **Bot** tab → *Reset Token* → copy into \`DISCORD_TOKEN\`.
${
  privileged.length
    ? `3. **Bot** tab → *Privileged Gateway Intents* → enable ${privileged
        .map((i) => `**${i === "MessageContent" ? "Message Content" : "Server Members"} Intent**`)
        .join(" and ")}. The bot will not see ${
        privileged.includes("MessageContent") ? "message text" : "member joins"
      } without this.\n`
    : ""
}${privileged.length ? "4" : "3"}. **OAuth2 → URL Generator** → scopes \`bot\` + \`applications.commands\`, then invite it.

Gateway intents used: ${intents.map((i) => `\`${i}\``).join(", ")}.

## The knowledge base

Everything in \`knowledge/*.md\` is chunked and indexed at boot. The first
\`# Heading\` in a file becomes the citation title.

- Drop in more \`.md\` files and restart.
${blueprint.skills.includes("rag-knowledge") ? `- Or add documents live with \`/${ctx.cmd("learn")}\` — no restart needed.\n` : ""}
Retrieval is BM25 by default. Set \`VOYAGE_API_KEY\` and it blends in semantic
search, which catches paraphrases that keyword matching misses. Both paths are
in \`src/core/rag.js\` and the blend weight is one line if you want to tune it.

## Layout

\`\`\`
index.js              gateway wiring, command dispatch, event fan-out
deploy-commands.js    slash command registration
src/core/config.js    your blueprint, frozen into constants
src/core/brain.js     every model call lives here
src/core/rag.js       hybrid retriever
src/core/memory.js    per-channel rolling memory
src/core/store.js     JSON file persistence
src/skills/           one file per skill
knowledge/            markdown documents
data/                 runtime state (gitignored)
\`\`\`

## Adding a skill

Create \`src/skills/my-skill.js\`:

\`\`\`js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  id: 'my-skill',
  commands: [
    {
      data: new SlashCommandBuilder().setName('ping').setDescription('Ping'),
      async execute(interaction, ctx) {
        // ctx = { brain, rag, retriever, log }
        await interaction.reply('pong');
      },
    },
  ],
  events: [],
};
\`\`\`

Add \`require('./my-skill'),\` to \`src/skills/registry.js\`, then \`npm run deploy\`.

## Cost

Model calls happen on the mind commands and on mentions — not on every message.
\`MIND.effort\` in \`src/core/config.js\` is the main dial: drop it to \`low\` for
cheap chat, raise it for analysis.
`;
}

const GITIGNORE = `node_modules/
.env
data/
*.log
`;

function knowledgeFiles(blueprint: Blueprint): GeneratedFile[] {
  if (!blueprint.knowledge.length) {
    return [
      {
        path: "knowledge/README.md",
        content: `# About this server

This is a starter document so the retriever has something to index.
Replace it with real content — server rules, product docs, FAQs, decisions.

Every \`.md\` file in this directory is chunked on boot. The first heading
becomes the citation title, so keep headings descriptive.
`,
      },
    ];
  }

  const used = new Set<string>();
  return blueprint.knowledge.map((doc) => {
    let slug = slugify(doc.title);
    while (used.has(slug)) slug = `${slug}-2`;
    used.add(slug);
    return {
      path: `knowledge/${slug}.md`,
      content: `# ${doc.title}\n\n${doc.content.trim()}\n`,
    };
  });
}

/** Builds the full project as an in-memory file list. */
export function generateProject(blueprint: Blueprint): GeneratedFile[] {
  const skills = getSkills(blueprint.skills);
  const ctx = skillContext(blueprint);

  return [
    { path: "package.json", content: packageFile(blueprint) },
    { path: ".env.example", content: envFile(blueprint) },
    { path: ".gitignore", content: GITIGNORE },
    { path: "README.md", content: readmeFile(blueprint) },
    { path: "index.js", content: entryFile(blueprint) },
    { path: "deploy-commands.js", content: deployFile(blueprint) },
    { path: "blueprint.json", content: `${JSON.stringify(blueprint, null, 2)}\n` },
    { path: "src/core/config.js", content: configFile(blueprint) },
    { path: "src/core/log.js", content: LOG_FILE },
    { path: "src/core/store.js", content: STORE_FILE },
    { path: "src/core/discord.js", content: DISCORD_HELPERS_FILE },
    { path: "src/core/rag.js", content: RAG_FILE },
    { path: "src/core/memory.js", content: MEMORY_FILE },
    { path: "src/core/brain.js", content: brainFile(blueprint) },
    { path: "src/skills/registry.js", content: registryFile(blueprint) },
    ...skills.map((skill) => ({ path: `src/skills/${skill.id}.js`, content: skill.code(ctx) })),
    ...knowledgeFiles(blueprint),
  ];
}

/** File tree preview for the UI, no content. */
export function projectTree(blueprint: Blueprint): string[] {
  return generateProject(blueprint)
    .map((file) => file.path)
    .sort();
}
