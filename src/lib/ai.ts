import Anthropic from "@anthropic-ai/sdk";
import { DraftSchema, type Blueprint, type Draft } from "./blueprint";
import { SKILL_IDS, SKILLS } from "./skills";
import { formatContext, type Hit } from "./rag";

export const MODEL = "claude-opus-5";

/**
 * The app is useful without credentials: every model call has a deterministic
 * fallback so the builder, the playground and the export all work offline.
 * `source` on each result tells the UI which path produced it.
 */
export type Source = "ai" | "fallback";

export function apiKeyPresent(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function thinkingOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.ThinkingBlock => block.type === "thinking")
    .map((block) => block.thinking)
    .join("\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Blueprint drafting
// ---------------------------------------------------------------------------

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Short, memorable bot name. No 'Bot' suffix." },
    tagline: { type: "string", description: "One line, under 100 characters, describing what it does." },
    persona: {
      type: "string",
      description:
        "The system prompt for the bot: who it is, how it speaks, what it refuses. Second person, 3-6 sentences, concrete.",
    },
    namespace: {
      type: "string",
      description:
        "Lowercase slash-command namespace, or an empty string for none. Only use one if the name is long or collisions are likely.",
    },
    accent: { type: "string", description: "Hex colour like #7c5cff that suits the bot's character." },
    skills: {
      type: "array",
      description: "Skill ids to enable. Pick only what the brief actually calls for.",
      items: { type: "string", enum: SKILL_IDS },
    },
    mind: {
      type: "object",
      properties: {
        think: { type: "boolean", description: "Deep step-by-step reasoning." },
        ideas: { type: "boolean", description: "Divergent brainstorming." },
        recall: { type: "boolean", description: "Retrieval over the knowledge base." },
        memory: { type: "boolean", description: "Rolling per-channel conversation memory." },
        effort: { type: "string", enum: ["low", "medium", "high", "xhigh"] },
      },
      required: ["think", "ideas", "recall", "memory", "effort"],
      additionalProperties: false,
    },
  },
  required: ["name", "tagline", "persona", "namespace", "accent", "skills", "mind"],
  additionalProperties: false,
} as const;

const ARCHITECT_SYSTEM = `You design Discord bots. Given a brief, produce one blueprint.

Available skills:
${SKILLS.map((s) => `- ${s.id} (${s.group}): ${s.summary}`).join("\n")}

Rules:
- Enable only skills the brief actually implies. A quiet knowledge bot does not need levels or polls.
- ai-chat is the backbone of every conversational bot; include it whenever the bot should talk.
- rag-knowledge belongs on any bot expected to know server-specific things.
- Write the persona as instructions addressed to the bot ("You are..."), specific to this server's job. No generic "helpful assistant" filler.
- effort: low for simple chat, high for research or analysis, xhigh only for genuinely hard reasoning work.
- Match the accent colour to the character, not to a default palette.`;

/** Heuristic blueprint used when no API key is configured. */
function fallbackDraft(brief: string): Draft {
  const text = brief.toLowerCase();
  const has = (...needles: string[]) => needles.some((n) => text.includes(n));

  const skills = new Set<string>(["ai-chat"]);
  if (has("knowledge", "docs", "faq", "wiki", "rag", "learn", "manual")) skills.add("rag-knowledge");
  if (has("think", "reason", "analy", "research", "deep")) skills.add("think-mode");
  if (has("idea", "brainstorm", "creative", "concept")) skills.add("idea-engine");
  if (has("summar", "catch up", "recap", "digest")) skills.add("summarize");
  if (has("moderat", "mod ", "spam", "ban", "purge", "timeout")) skills.add("moderation");
  if (has("welcome", "onboard", "new member", "greet")) skills.add("welcome");
  if (has("poll", "vote", "survey")) skills.add("polls");
  if (has("remind", "deadline", "schedule")) skills.add("reminders");
  if (has("support", "ticket", "help desk", "helpdesk")) skills.add("tickets");
  if (has("translat", "language", "multilingual", "bahasa")) skills.add("translate");
  if (has("level", "xp", "rank", "leaderboard", "activity")) skills.add("levels");
  if (has("persona", "personality", "tone")) skills.add("persona");

  // A bare brief still deserves a capable default.
  if (skills.size === 1) {
    skills.add("rag-knowledge");
    skills.add("think-mode");
  }

  const firstSentence = brief.trim().split(/[.!?\n]/)[0]?.trim() ?? "";

  return {
    name: "Atlas",
    tagline: firstSentence.slice(0, 120) || "An AI companion for your server.",
    persona: `You are Atlas, an AI member of this Discord server. Your job: ${
      firstSentence || "help members with whatever they ask"
    }. Answer from the server's knowledge base when it is relevant and cite what you used. Say plainly when you do not know something rather than guessing. Keep replies short enough to read on a phone.`,
    namespace: "",
    accent: "#7c5cff",
    skills: [...skills],
    mind: {
      think: skills.has("think-mode"),
      ideas: skills.has("idea-engine"),
      recall: skills.has("rag-knowledge"),
      memory: true,
      effort: has("research", "analy", "deep", "complex") ? "high" : "medium",
    },
  };
}

export async function draftBlueprint(
  brief: string,
): Promise<{ draft: Draft; source: Source; note?: string }> {
  if (!apiKeyPresent()) {
    return {
      draft: fallbackDraft(brief),
      source: "fallback",
      note: "Set ANTHROPIC_API_KEY to have Claude design the blueprint. This one was matched from keywords.",
    };
  }

  try {
    const message = await client().messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: ARCHITECT_SYSTEM,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: DRAFT_SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [{ role: "user", content: `Brief:\n${brief}` }],
    });

    const parsed = DraftSchema.safeParse(JSON.parse(textOf(message)));
    if (!parsed.success) {
      return {
        draft: fallbackDraft(brief),
        source: "fallback",
        note: "The model returned a blueprint that failed validation, so a keyword match was used instead.",
      };
    }

    // Guard against a hallucinated skill id slipping through the enum.
    const draft = { ...parsed.data, skills: parsed.data.skills.filter((id) => SKILL_IDS.includes(id)) };
    if (!draft.skills.length) draft.skills = ["ai-chat"];

    return { draft, source: "ai" };
  } catch (error) {
    return {
      draft: fallbackDraft(brief),
      source: "fallback",
      note: `Model call failed (${(error as Error).message}). Fell back to a keyword match.`,
    };
  }
}

// ---------------------------------------------------------------------------
// Playground
// ---------------------------------------------------------------------------

export type PlaygroundMode = "ask" | "think" | "idea";

export interface PlaygroundResult {
  text: string;
  reasoning?: string;
  citations: string[];
  source: Source;
}

function playgroundSystem(blueprint: Blueprint, mode: PlaygroundMode, hits: Hit[]): string {
  const parts = [blueprint.persona];

  if (hits.length) {
    parts.push(
      `Knowledge base excerpts you may use. Cite them inline as [1], [2] when you rely on them:\n\n${formatContext(hits)}`,
    );
  } else if (blueprint.mind.recall) {
    parts.push(
      "The knowledge base returned nothing for this question. Say so rather than inventing server-specific facts.",
    );
  }

  if (mode === "think") {
    parts.push(
      "Work through this carefully before answering. Give the answer first, then a short 'How I got there' section of at most three sentences.",
    );
  }
  if (mode === "idea") {
    parts.push(
      "Produce genuinely different directions, not variations on one. Each gets a bold title and two sentences. Aim for five.",
    );
  }

  parts.push("You are replying in a Discord message. Keep it under 1500 characters and skip markdown headers.");
  return parts.join("\n\n");
}

function fallbackReply(mode: PlaygroundMode, question: string, hits: Hit[]): string {
  if (hits.length) {
    const cited = hits
      .slice(0, 2)
      .map((hit, i) => `[${i + 1}] ${hit.title}: ${hit.text.replace(/\s+/g, " ").slice(0, 260)}…`)
      .join("\n\n");
    return `**Offline preview** — retrieval ran for real, the reply did not.\n\nYour knowledge base matched ${hits.length} passage(s) for "${question}":\n\n${cited}\n\nAdd \`ANTHROPIC_API_KEY\` and this becomes a written answer over the same passages.`;
  }

  const hint =
    mode === "think"
      ? "Think mode would reason through this at higher effort before answering."
      : mode === "idea"
        ? "Idea mode would return five distinct directions here."
        : "Ask mode would answer from the knowledge base and cite what it used.";

  return `**Offline preview** — no \`ANTHROPIC_API_KEY\` is set, so this is not a model reply.\n\nNothing in the knowledge base matched "${question}". ${hint}\n\nPaste a document into the Knowledge step and retrieval will start hitting.`;
}

export async function playgroundReply(args: {
  blueprint: Blueprint;
  question: string;
  hits: Hit[];
  mode: PlaygroundMode;
}): Promise<PlaygroundResult> {
  const { blueprint, question, hits, mode } = args;
  const citations = hits.map((hit) => hit.title);

  if (!apiKeyPresent()) {
    return { text: fallbackReply(mode, question, hits), citations, source: "fallback" };
  }

  try {
    const effort = mode === "think" ? "high" : blueprint.mind.effort;

    const message = await client().messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: playgroundSystem(blueprint, mode, hits),
      thinking: mode === "think" ? { type: "adaptive", display: "summarized" } : { type: "adaptive" },
      output_config: { effort },
      messages: [{ role: "user", content: question }],
    });

    return {
      text: textOf(message) || "(empty reply)",
      reasoning: mode === "think" ? thinkingOf(message) || undefined : undefined,
      citations,
      source: "ai",
    };
  } catch (error) {
    return {
      text: `The model call failed: ${(error as Error).message}`,
      citations,
      source: "fallback",
    };
  }
}
