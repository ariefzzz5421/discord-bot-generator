import type { Blueprint } from "./blueprint";
import { commandName } from "./blueprint";

export type SkillGroup = "mind" | "community" | "utility" | "moderation";

export interface SkillContext {
  blueprint: Blueprint;
  /** Namespaced slash-command name. */
  cmd: (base: string) => string;
}

export interface Skill {
  id: string;
  name: string;
  emoji: string;
  group: SkillGroup;
  summary: string;
  /** Shown on the card so the user knows what they get. */
  commands: string[];
  /** Extra Discord gateway intents this skill needs. */
  intents?: string[];
  /** Extra gateway partials this skill needs. */
  partials?: string[];
  /** True when the skill calls the model. */
  usesModel?: boolean;
  /** Emits the skill's module source for the generated bot. */
  code: (ctx: SkillContext) => string;
}

const AI_CHAT: Skill = {
  id: "ai-chat",
  name: "AI Conversation",
  emoji: "💬",
  group: "mind",
  summary:
    "Answers questions in channel and replies whenever the bot is mentioned. The backbone skill — every other mind skill builds on it.",
  commands: ["/ask"],
  intents: ["GuildMessages", "MessageContent"],
  usesModel: true,
  code: ({ cmd }) => `const { SlashCommandBuilder } = require('discord.js');
const { reply, chunk } = require('../core/discord');

module.exports = {
  id: 'ai-chat',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('${cmd("ask")}')
        .setDescription('Ask a question. Uses the knowledge base when it helps.')
        .addStringOption((o) =>
          o.setName('question').setDescription('What do you want to know?').setRequired(true),
        ),
      async execute(interaction, ctx) {
        await interaction.deferReply();
        const question = interaction.options.getString('question', true);
        const answer = await ctx.brain.answer({
          question,
          channelId: interaction.channelId,
          guildId: interaction.guildId,
        });
        await reply(interaction, answer);
      },
    },
  ],
  events: [
    {
      name: 'messageCreate',
      async run(client, ctx, message) {
        if (message.author.bot) return;
        if (!message.mentions.has(client.user)) return;

        const question = message.content.replace(/<@!?\\d+>/g, '').trim();
        if (!question) return;

        await message.channel.sendTyping();
        const answer = await ctx.brain.answer({
          question,
          channelId: message.channelId,
          guildId: message.guildId,
        });
        for (const part of chunk(answer)) await message.reply(part);
      },
    },
  ],
};
`,
};

const RAG_KNOWLEDGE: Skill = {
  id: "rag-knowledge",
  name: "Knowledge Base (RAG)",
  emoji: "📚",
  group: "mind",
  summary:
    "Teach the bot things at runtime with /learn. Retrieval runs a hybrid of BM25 keyword scoring and optional embeddings, and answers cite their sources.",
  commands: ["/learn", "/recall", "/sources", "/forget"],
  usesModel: true,
  code: ({ cmd }) => `const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { reply } = require('../core/discord');

module.exports = {
  id: 'rag-knowledge',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('${cmd("learn")}')
        .setDescription('Teach me something. Stored in the knowledge base and used in future answers.')
        .addStringOption((o) => o.setName('title').setDescription('Short title').setRequired(true))
        .addStringOption((o) => o.setName('content').setDescription('What should I remember?').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
      async execute(interaction, ctx) {
        await interaction.deferReply({ ephemeral: true });
        const title = interaction.options.getString('title', true);
        const content = interaction.options.getString('content', true);
        const doc = await ctx.rag.learn({ title, content, author: interaction.user.tag });
        await reply(
          interaction,
          'Learned **' + title + '** (' + doc.chunks + ' chunk' + (doc.chunks === 1 ? '' : 's') + '). I will use it from now on.',
        );
      },
    },
    {
      data: new SlashCommandBuilder()
        .setName('${cmd("recall")}')
        .setDescription('Answer strictly from the knowledge base, with citations.')
        .addStringOption((o) => o.setName('question').setDescription('What do you want to know?').setRequired(true)),
      async execute(interaction, ctx) {
        await interaction.deferReply();
        const question = interaction.options.getString('question', true);
        const answer = await ctx.brain.answer({
          question,
          channelId: interaction.channelId,
          guildId: interaction.guildId,
          groundedOnly: true,
        });
        await reply(interaction, answer);
      },
    },
    {
      data: new SlashCommandBuilder()
        .setName('${cmd("sources")}')
        .setDescription('Show which knowledge documents match a query, and how strongly.')
        .addStringOption((o) => o.setName('query').setDescription('Search the knowledge base').setRequired(true)),
      async execute(interaction, ctx) {
        await interaction.deferReply({ ephemeral: true });
        const query = interaction.options.getString('query', true);
        const hits = await ctx.rag.search(query, 5);
        if (!hits.length) {
          await reply(interaction, 'Nothing in the knowledge base matches that yet.');
          return;
        }
        const lines = hits.map(
          (h, i) => (i + 1) + '. **' + h.title + '** — score ' + h.score.toFixed(2) + '\\n> ' + h.excerpt,
        );
        await reply(interaction, lines.join('\\n'));
      },
    },
    {
      data: new SlashCommandBuilder()
        .setName('${cmd("forget")}')
        .setDescription('Remove a document from the knowledge base.')
        .addStringOption((o) => o.setName('title').setDescription('Title to forget').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
      async execute(interaction, ctx) {
        await interaction.deferReply({ ephemeral: true });
        const title = interaction.options.getString('title', true);
        const removed = await ctx.rag.forget(title);
        await reply(interaction, removed ? 'Forgot **' + title + '**.' : 'I have nothing stored under that title.');
      },
    },
  ],
  events: [],
};
`,
};

const THINK_MODE: Skill = {
  id: "think-mode",
  name: "Think Mode",
  emoji: "🧠",
  group: "mind",
  summary:
    "Deep reasoning on hard questions. Runs at higher effort with adaptive thinking and posts a short summary of how it got there.",
  commands: ["/think"],
  usesModel: true,
  code: ({ cmd }) => `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { ACCENT } = require('../core/config');
const { chunk } = require('../core/discord');

module.exports = {
  id: 'think-mode',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('${cmd("think")}')
        .setDescription('Reason carefully through a hard problem before answering.')
        .addStringOption((o) => o.setName('problem').setDescription('The problem to work through').setRequired(true))
        .addBooleanOption((o) =>
          o.setName('show_reasoning').setDescription('Include a summary of the reasoning (default: true)'),
        ),
      async execute(interaction, ctx) {
        await interaction.deferReply();
        const problem = interaction.options.getString('problem', true);
        const showReasoning = interaction.options.getBoolean('show_reasoning') ?? true;

        const result = await ctx.brain.think({
          problem,
          channelId: interaction.channelId,
          guildId: interaction.guildId,
        });

        const embed = new EmbedBuilder()
          .setColor(ACCENT)
          .setTitle('🧠 ' + problem.slice(0, 240))
          .setDescription(result.answer.slice(0, 4000));

        if (showReasoning && result.reasoning) {
          embed.addFields({ name: 'How I got there', value: result.reasoning.slice(0, 1000) });
        }

        await interaction.editReply({ embeds: [embed] });

        // Anything that overflowed the embed goes out as follow-up messages.
        if (result.answer.length > 4000) {
          for (const part of chunk(result.answer.slice(4000))) await interaction.followUp(part);
        }
      },
    },
  ],
  events: [],
};
`,
};

const IDEA_ENGINE: Skill = {
  id: "idea-engine",
  name: "Idea Engine",
  emoji: "💡",
  group: "mind",
  summary:
    "Divergent then convergent brainstorming: generates distinct angles rather than variations on one, then expands whichever you pick.",
  commands: ["/idea", "/expand"],
  usesModel: true,
  code: ({ cmd }) => `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { ACCENT } = require('../core/config');
const { reply } = require('../core/discord');

module.exports = {
  id: 'idea-engine',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('${cmd("idea")}')
        .setDescription('Brainstorm genuinely different directions on a topic.')
        .addStringOption((o) => o.setName('topic').setDescription('What are we thinking about?').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('count').setDescription('How many directions (2-8, default 5)').setMinValue(2).setMaxValue(8),
        ),
      async execute(interaction, ctx) {
        await interaction.deferReply();
        const topic = interaction.options.getString('topic', true);
        const count = interaction.options.getInteger('count') ?? 5;

        const ideas = await ctx.brain.ideas({ topic, count, guildId: interaction.guildId });

        const embed = new EmbedBuilder()
          .setColor(ACCENT)
          .setTitle('💡 ' + topic.slice(0, 240))
          .setFooter({ text: 'Pick one and run /${cmd("expand")} to go deeper.' });

        for (const idea of ideas.slice(0, 8)) {
          embed.addFields({
            name: idea.title.slice(0, 240),
            value: (idea.detail || '—').slice(0, 1000),
          });
        }

        await interaction.editReply({ embeds: [embed] });
      },
    },
    {
      data: new SlashCommandBuilder()
        .setName('${cmd("expand")}')
        .setDescription('Take one idea and develop it into something concrete.')
        .addStringOption((o) => o.setName('idea').setDescription('The idea to develop').setRequired(true)),
      async execute(interaction, ctx) {
        await interaction.deferReply();
        const idea = interaction.options.getString('idea', true);
        const text = await ctx.brain.expand({
          idea,
          channelId: interaction.channelId,
          guildId: interaction.guildId,
        });
        await reply(interaction, text);
      },
    },
  ],
  events: [],
};
`,
};

const SUMMARIZE: Skill = {
  id: "summarize",
  name: "Catch Me Up",
  emoji: "📝",
  group: "mind",
  summary:
    "Reads back over recent channel history and produces a briefing — decisions made, open questions, who is waiting on what.",
  commands: ["/catchup"],
  intents: ["GuildMessages", "MessageContent"],
  usesModel: true,
  code: ({ cmd }) => `const { SlashCommandBuilder } = require('discord.js');
const { reply } = require('../core/discord');

module.exports = {
  id: 'summarize',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('${cmd("catchup")}')
        .setDescription('Summarise what happened in this channel recently.')
        .addIntegerOption((o) =>
          o
            .setName('messages')
            .setDescription('How far back to read (10-200, default 60)')
            .setMinValue(10)
            .setMaxValue(200),
        ),
      async execute(interaction, ctx) {
        await interaction.deferReply();
        const limit = interaction.options.getInteger('messages') ?? 60;

        const fetched = await interaction.channel.messages.fetch({ limit });
        const transcript = [...fetched.values()]
          .reverse()
          .filter((m) => m.content && !m.author.bot)
          .map((m) => m.author.username + ': ' + m.content)
          .join('\\n');

        if (!transcript) {
          await reply(interaction, 'There is nothing here to summarise yet.');
          return;
        }

        const summary = await ctx.brain.summarize({ transcript, guildId: interaction.guildId });
        await reply(interaction, summary);
      },
    },
  ],
  events: [],
};
`,
};

const PERSONA_SWITCH: Skill = {
  id: "persona",
  name: "Live Persona",
  emoji: "🎭",
  group: "mind",
  summary:
    "Change how the bot talks without redeploying. Server admins can adjust the persona at runtime and reset to the original.",
  commands: ["/persona set", "/persona show", "/persona reset"],
  code: ({ cmd }) => `const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { reply } = require('../core/discord');

module.exports = {
  id: 'persona',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('${cmd("persona")}')
        .setDescription('Inspect or change how I speak.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((s) =>
          s
            .setName('set')
            .setDescription('Override my persona for this server')
            .addStringOption((o) => o.setName('persona').setDescription('New persona').setRequired(true)),
        )
        .addSubcommand((s) => s.setName('show').setDescription('Show my current persona'))
        .addSubcommand((s) => s.setName('reset').setDescription('Restore the persona I shipped with')),
      async execute(interaction, ctx) {
        await interaction.deferReply({ ephemeral: true });
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'set') {
          const persona = interaction.options.getString('persona', true);
          await ctx.brain.setPersona(guildId, persona);
          await reply(interaction, 'Persona updated for this server.');
          return;
        }
        if (sub === 'reset') {
          await ctx.brain.setPersona(guildId, null);
          await reply(interaction, 'Persona restored to default.');
          return;
        }
        await reply(interaction, '\`\`\`\\n' + (await ctx.brain.getPersona(guildId)).slice(0, 1800) + '\\n\`\`\`');
      },
    },
  ],
  events: [],
};
`,
};

const MODERATION: Skill = {
  id: "moderation",
  name: "Moderation",
  emoji: "🛡️",
  group: "moderation",
  summary:
    "Bulk delete, timeout and warn, with every action written to an audit log channel. Permission-gated at the Discord level, not just in code.",
  commands: ["/purge", "/timeout", "/warn"],
  intents: ["GuildModeration", "GuildMembers"],
  code: ({ cmd }) => `const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { ACCENT } = require('../core/config');
const { reply } = require('../core/discord');

async function audit(interaction, ctx, action, detail) {
  ctx.log.info('[mod] ' + action + ' — ' + detail);
  const channelName = process.env.MOD_LOG_CHANNEL;
  if (!channelName) return;
  const channel = interaction.guild.channels.cache.find((c) => c.name === channelName && c.isTextBased?.());
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(action)
    .setDescription(detail)
    .setFooter({ text: 'by ' + interaction.user.tag })
    .setTimestamp();
  await channel.send({ embeds: [embed] }).catch(() => {});
}

module.exports = {
  id: 'moderation',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('${cmd("purge")}')
        .setDescription('Bulk delete recent messages in this channel.')
        .addIntegerOption((o) =>
          o.setName('count').setDescription('How many (1-100)').setRequired(true).setMinValue(1).setMaxValue(100),
        )
        .addUserOption((o) => o.setName('user').setDescription('Only delete this user\\'s messages'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
      async execute(interaction, ctx) {
        await interaction.deferReply({ ephemeral: true });
        const count = interaction.options.getInteger('count', true);
        const user = interaction.options.getUser('user');

        // Discord refuses to bulk-delete anything older than 14 days.
        const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
        const fetched = await interaction.channel.messages.fetch({ limit: 100 });
        const targets = [...fetched.values()]
          .filter((m) => m.createdTimestamp > cutoff)
          .filter((m) => (user ? m.author.id === user.id : true))
          .slice(0, count);

        if (!targets.length) {
          await reply(interaction, 'Nothing to delete — messages older than 14 days cannot be bulk deleted.');
          return;
        }

        const deleted = await interaction.channel.bulkDelete(targets, true);
        await reply(interaction, 'Deleted ' + deleted.size + ' message(s).');
        await audit(interaction, ctx, 'Purge', 'Deleted ' + deleted.size + ' message(s) in #' + interaction.channel.name);
      },
    },
    {
      data: new SlashCommandBuilder()
        .setName('${cmd("timeout")}')
        .setDescription('Time a member out.')
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addIntegerOption((o) =>
          o
            .setName('minutes')
            .setDescription('For how long (1-10080)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(10080),
        )
        .addStringOption((o) => o.setName('reason').setDescription('Why'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
      async execute(interaction, ctx) {
        await interaction.deferReply({ ephemeral: true });
        const user = interaction.options.getUser('user', true);
        const minutes = interaction.options.getInteger('minutes', true);
        const reason = interaction.options.getString('reason') ?? 'No reason given';

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) {
          await reply(interaction, 'That user is not in this server.');
          return;
        }
        if (!member.moderatable) {
          await reply(interaction, 'I do not have permission to time that member out.');
          return;
        }

        await member.timeout(minutes * 60 * 1000, reason);
        await reply(interaction, 'Timed out ' + user.tag + ' for ' + minutes + ' minute(s).');
        await audit(interaction, ctx, 'Timeout', user.tag + ' for ' + minutes + 'm — ' + reason);
      },
    },
    {
      data: new SlashCommandBuilder()
        .setName('${cmd("warn")}')
        .setDescription('Warn a member. Sends them a DM and records it.')
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Why').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
      async execute(interaction, ctx) {
        await interaction.deferReply({ ephemeral: true });
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason', true);

        const dm = await user
          .send('You were warned in **' + interaction.guild.name + '**: ' + reason)
          .then(() => true)
          .catch(() => false);

        await reply(interaction, 'Warned ' + user.tag + (dm ? '.' : ' (their DMs are closed).'));
        await audit(interaction, ctx, 'Warning', user.tag + ' — ' + reason);
      },
    },
  ],
  events: [],
};
`,
};

const WELCOME: Skill = {
  id: "welcome",
  name: "Welcome Committee",
  emoji: "👋",
  group: "community",
  summary:
    "Greets new members with a message written for them, grounded in the knowledge base so newcomers get real orientation instead of boilerplate.",
  commands: [],
  intents: ["GuildMembers"],
  usesModel: true,
  code: () => `const { EmbedBuilder } = require('discord.js');
const { ACCENT, BOT_NAME } = require('../core/config');

module.exports = {
  id: 'welcome',
  commands: [],
  events: [
    {
      name: 'guildMemberAdd',
      async run(client, ctx, member) {
        const channelName = process.env.WELCOME_CHANNEL || 'general';
        const channel = member.guild.channels.cache.find((c) => c.name === channelName && c.isTextBased?.());
        if (!channel) {
          ctx.log.warn('[welcome] no channel named #' + channelName);
          return;
        }

        const greeting = await ctx.brain.welcome({
          username: member.user.username,
          guildName: member.guild.name,
        });

        const embed = new EmbedBuilder()
          .setColor(ACCENT)
          .setTitle('Welcome, ' + member.user.username + '!')
          .setDescription(greeting)
          .setThumbnail(member.user.displayAvatarURL())
          .setFooter({ text: BOT_NAME });

        await channel.send({ content: '<@' + member.id + '>', embeds: [embed] }).catch(() => {});
      },
    },
  ],
};
`,
};

const POLLS: Skill = {
  id: "polls",
  name: "Polls",
  emoji: "📊",
  group: "community",
  summary:
    "Button-based polls with live vote counts. One vote per person, changeable, and results tally in place without spawning reaction clutter.",
  commands: ["/poll"],
  code: ({ cmd }) => `const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { ACCENT } = require('../core/config');

// pollId -> { question, options: string[], votes: Map<userId, optionIndex> }
const polls = new Map();

function render(poll) {
  const total = poll.votes.size;
  const counts = poll.options.map(() => 0);
  for (const choice of poll.votes.values()) counts[choice] = (counts[choice] ?? 0) + 1;

  const lines = poll.options.map((option, i) => {
    const count = counts[i];
    const share = total ? Math.round((count / total) * 100) : 0;
    const filled = Math.round(share / 10);
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
    return '**' + option + '**\\n\`' + bar + '\` ' + share + '% (' + count + ')';
  });

  return new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('📊 ' + poll.question)
    .setDescription(lines.join('\\n\\n'))
    .setFooter({ text: total + ' vote' + (total === 1 ? '' : 's') });
}

module.exports = {
  id: 'polls',
  commands: [
    {
      data: (() => {
        const builder = new SlashCommandBuilder()
          .setName('${cmd("poll")}')
          .setDescription('Start a poll with up to five options.')
          .addStringOption((o) => o.setName('question').setDescription('The question').setRequired(true))
          .addStringOption((o) => o.setName('option1').setDescription('First option').setRequired(true))
          .addStringOption((o) => o.setName('option2').setDescription('Second option').setRequired(true));
        for (const n of [3, 4, 5]) {
          builder.addStringOption((o) => o.setName('option' + n).setDescription('Option ' + n));
        }
        return builder;
      })(),
      async execute(interaction) {
        const question = interaction.options.getString('question', true);
        const options = [1, 2, 3, 4, 5]
          .map((n) => interaction.options.getString('option' + n))
          .filter((v) => typeof v === 'string' && v.length > 0);

        const pollId = interaction.id;
        const poll = { question, options, votes: new Map() };
        polls.set(pollId, poll);

        const rows = [];
        for (let i = 0; i < options.length; i += 5) {
          rows.push(
            new ActionRowBuilder().addComponents(
              options.slice(i, i + 5).map((option, j) =>
                new ButtonBuilder()
                  .setCustomId('poll:' + pollId + ':' + (i + j))
                  .setLabel(option.slice(0, 80))
                  .setStyle(ButtonStyle.Secondary),
              ),
            ),
          );
        }

        await interaction.reply({ embeds: [render(poll)], components: rows });
      },
    },
  ],
  events: [
    {
      name: 'interactionCreate',
      async run(client, ctx, interaction) {
        if (!interaction.isButton()) return;
        if (!interaction.customId.startsWith('poll:')) return;

        const [, pollId, rawIndex] = interaction.customId.split(':');
        const poll = polls.get(pollId);
        if (!poll) {
          await interaction.reply({ content: 'That poll has expired.', ephemeral: true });
          return;
        }

        poll.votes.set(interaction.user.id, Number(rawIndex));
        await interaction.update({ embeds: [render(poll)] });
      },
    },
  ],
};
`,
};

const REMINDERS: Skill = {
  id: "reminders",
  name: "Reminders",
  emoji: "⏰",
  group: "utility",
  summary:
    "Natural durations like `45m` or `2h30m`. Reminders survive restarts because they are persisted to disk, not held in a timer.",
  commands: ["/remind", "/reminders"],
  code: ({ cmd }) => `const { SlashCommandBuilder } = require('discord.js');
const { store } = require('../core/store');
const { reply } = require('../core/discord');

const reminders = store('reminders', []);

function parseDuration(input) {
  const pattern = /(\\d+)\\s*(w|d|h|m|s)/gi;
  const unitMs = { w: 604800000, d: 86400000, h: 3600000, m: 60000, s: 1000 };
  let total = 0;
  let match;
  while ((match = pattern.exec(input)) !== null) {
    total += Number(match[1]) * unitMs[match[2].toLowerCase()];
  }
  return total;
}

module.exports = {
  id: 'reminders',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('${cmd("remind")}')
        .setDescription('Remind me about something later.')
        .addStringOption((o) => o.setName('when').setDescription('e.g. 45m, 2h30m, 1d').setRequired(true))
        .addStringOption((o) => o.setName('what').setDescription('What should I remind you about?').setRequired(true)),
      async execute(interaction) {
        const when = interaction.options.getString('when', true);
        const what = interaction.options.getString('what', true);

        const ms = parseDuration(when);
        if (!ms) {
          await interaction.reply({
            content: 'I could not read that duration. Try something like \`45m\`, \`2h30m\` or \`1d\`.',
            ephemeral: true,
          });
          return;
        }

        const dueAt = Date.now() + ms;
        const all = reminders.read();
        all.push({
          id: interaction.id,
          userId: interaction.user.id,
          channelId: interaction.channelId,
          what,
          dueAt,
        });
        reminders.write(all);

        await interaction.reply({
          content: 'Got it — I will remind you <t:' + Math.floor(dueAt / 1000) + ':R>.',
          ephemeral: true,
        });
      },
    },
    {
      data: new SlashCommandBuilder()
        .setName('${cmd("reminders")}')
        .setDescription('List your pending reminders.'),
      async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const mine = reminders.read().filter((r) => r.userId === interaction.user.id);
        if (!mine.length) {
          await reply(interaction, 'You have no pending reminders.');
          return;
        }
        const lines = mine
          .sort((a, b) => a.dueAt - b.dueAt)
          .map((r) => '• ' + r.what + ' — <t:' + Math.floor(r.dueAt / 1000) + ':R>');
        await reply(interaction, lines.join('\\n'));
      },
    },
  ],
  events: [
    {
      name: 'ready',
      async run(client, ctx) {
        // Poll rather than setTimeout so reminders survive a restart.
        const tick = async () => {
          const all = reminders.read();
          const due = all.filter((r) => r.dueAt <= Date.now());
          if (!due.length) return;

          reminders.write(all.filter((r) => r.dueAt > Date.now()));

          for (const reminder of due) {
            const channel = await client.channels.fetch(reminder.channelId).catch(() => null);
            if (!channel?.isTextBased()) continue;
            await channel
              .send('<@' + reminder.userId + '> reminder: ' + reminder.what)
              .catch((error) => ctx.log.warn('[reminders] ' + error.message));
          }
        };

        setInterval(() => void tick(), 20000);
        void tick();
      },
    },
  ],
};
`,
};

const TICKETS: Skill = {
  id: "tickets",
  name: "Support Threads",
  emoji: "🎫",
  group: "utility",
  summary:
    "Opens a private thread per request and, when the mind skills are on, takes a first pass at the answer from the knowledge base before a human arrives.",
  commands: ["/ticket", "/close"],
  usesModel: true,
  code: ({ cmd }) => `const { SlashCommandBuilder, ChannelType } = require('discord.js');

module.exports = {
  id: 'tickets',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('${cmd("ticket")}')
        .setDescription('Open a support thread.')
        .addStringOption((o) => o.setName('subject').setDescription('What do you need help with?').setRequired(true)),
      async execute(interaction, ctx) {
        await interaction.deferReply({ ephemeral: true });
        const subject = interaction.options.getString('subject', true);

        const thread = await interaction.channel.threads.create({
          name: ('ticket-' + interaction.user.username + '-' + subject).slice(0, 90),
          type: ChannelType.PrivateThread,
          invitable: false,
        });

        await thread.members.add(interaction.user.id).catch(() => {});
        await interaction.editReply({ content: 'Opened ' + thread.toString() + '.' });

        await thread.send('<@' + interaction.user.id + '> — thanks, someone will pick this up. Let me try first:');

        const attempt = await ctx.brain.answer({
          question: subject,
          channelId: thread.id,
          guildId: interaction.guildId,
        });
        await thread.send(attempt.slice(0, 1900));
      },
    },
    {
      data: new SlashCommandBuilder()
        .setName('${cmd("close")}')
        .setDescription('Close the current support thread.'),
      async execute(interaction) {
        if (!interaction.channel?.isThread()) {
          await interaction.reply({ content: 'Run this inside a ticket thread.', ephemeral: true });
          return;
        }
        await interaction.reply('Closing this ticket. Reopen any time by starting a new one.');
        await interaction.channel.setArchived(true).catch(() => {});
      },
    },
  ],
  events: [],
};
`,
};

const TRANSLATE: Skill = {
  id: "translate",
  name: "Translate",
  emoji: "🌐",
  group: "utility",
  summary:
    "Translates on demand and preserves tone rather than producing something stiff and literal. Useful for multi-region servers.",
  commands: ["/translate"],
  usesModel: true,
  code: ({ cmd }) => `const { SlashCommandBuilder } = require('discord.js');
const { reply } = require('../core/discord');

module.exports = {
  id: 'translate',
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName('${cmd("translate")}')
        .setDescription('Translate text, keeping the tone of the original.')
        .addStringOption((o) => o.setName('text').setDescription('Text to translate').setRequired(true))
        .addStringOption((o) => o.setName('to').setDescription('Target language, e.g. Indonesian').setRequired(true)),
      async execute(interaction, ctx) {
        await interaction.deferReply();
        const text = interaction.options.getString('text', true);
        const to = interaction.options.getString('to', true);

        const result = await ctx.brain.raw({
          system:
            'You are a translator. Translate the user text into ' +
            to +
            '. Preserve tone, register and formatting. Reply with the translation only — no notes, no transliteration.',
          user: text,
          effort: 'low',
        });

        await reply(interaction, result.text);
      },
    },
  ],
  events: [],
};
`,
};

const LEVELS: Skill = {
  id: "levels",
  name: "Activity Levels",
  emoji: "⭐",
  group: "community",
  summary:
    "XP for participation with a per-minute cooldown so it rewards conversation rather than spam. Includes a server leaderboard.",
  commands: ["/rank", "/leaderboard"],
  intents: ["GuildMessages", "MessageContent"],
  code: ({ cmd }) => `const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { ACCENT } = require('../core/config');
const { store } = require('../core/store');

const levels = store('levels', {});
const cooldown = new Map();

const levelFor = (xp) => Math.floor(0.15 * Math.sqrt(xp));
const xpForLevel = (level) => Math.ceil((level / 0.15) ** 2);

module.exports = {
  id: 'levels',
  commands: [
    {
      data: new SlashCommandBuilder().setName('${cmd("rank")}').setDescription('Show your activity level.'),
      async execute(interaction) {
        const data = levels.read();
        const xp = data[interaction.user.id]?.xp ?? 0;
        const level = levelFor(xp);
        const next = xpForLevel(level + 1);

        const embed = new EmbedBuilder()
          .setColor(ACCENT)
          .setTitle(interaction.user.username)
          .addFields(
            { name: 'Level', value: String(level), inline: true },
            { name: 'XP', value: String(xp), inline: true },
            { name: 'To next level', value: String(Math.max(0, next - xp)), inline: true },
          );

        await interaction.reply({ embeds: [embed] });
      },
    },
    {
      data: new SlashCommandBuilder()
        .setName('${cmd("leaderboard")}')
        .setDescription('Top ten most active members.'),
      async execute(interaction) {
        const data = levels.read();
        const top = Object.entries(data)
          .sort((a, b) => b[1].xp - a[1].xp)
          .slice(0, 10);

        if (!top.length) {
          await interaction.reply({ content: 'No activity recorded yet.', ephemeral: true });
          return;
        }

        const lines = top.map(
          ([userId, entry], i) =>
            (i + 1) + '. <@' + userId + '> — level ' + levelFor(entry.xp) + ' (' + entry.xp + ' XP)',
        );

        const embed = new EmbedBuilder().setColor(ACCENT).setTitle('⭐ Leaderboard').setDescription(lines.join('\\n'));
        await interaction.reply({ embeds: [embed] });
      },
    },
  ],
  events: [
    {
      name: 'messageCreate',
      async run(client, ctx, message) {
        if (message.author.bot || !message.guild) return;

        // One XP grant per user per minute — rewards conversation, not flooding.
        const last = cooldown.get(message.author.id) ?? 0;
        if (Date.now() - last < 60000) return;
        cooldown.set(message.author.id, Date.now());

        const data = levels.read();
        const entry = data[message.author.id] ?? { xp: 0 };
        const before = levelFor(entry.xp);
        entry.xp += 10 + Math.floor(Math.random() * 6);
        data[message.author.id] = entry;
        levels.write(data);

        const after = levelFor(entry.xp);
        if (after > before) {
          await message.channel
            .send('<@' + message.author.id + '> reached level **' + after + '**.')
            .catch(() => {});
        }
      },
    },
  ],
};
`,
};

export const SKILLS: Skill[] = [
  AI_CHAT,
  RAG_KNOWLEDGE,
  THINK_MODE,
  IDEA_ENGINE,
  SUMMARIZE,
  PERSONA_SWITCH,
  MODERATION,
  WELCOME,
  POLLS,
  REMINDERS,
  TICKETS,
  TRANSLATE,
  LEVELS,
];

export const SKILL_IDS = SKILLS.map((s) => s.id);

export function getSkills(ids: string[]): Skill[] {
  const wanted = new Set(ids);
  return SKILLS.filter((s) => wanted.has(s.id));
}

export function skillContext(blueprint: Blueprint): SkillContext {
  return { blueprint, cmd: (base) => commandName(blueprint, base) };
}

export const GROUP_LABELS: Record<SkillGroup, string> = {
  mind: "Mind",
  community: "Community",
  utility: "Utility",
  moderation: "Moderation",
};
