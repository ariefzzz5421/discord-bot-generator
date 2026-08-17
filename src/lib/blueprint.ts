import { z } from "zod";

/**
 * A Blueprint is the single source of truth for a generated bot.
 * The AI produces one from a plain-language brief; the codegen turns it into a project.
 */

export const KnowledgeDocSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  content: z.string().min(1),
});

export const MindSchema = z.object({
  /** Deep multi-step reasoning before answering. */
  think: z.boolean(),
  /** Divergent idea generation / brainstorming. */
  ideas: z.boolean(),
  /** Retrieval over the knowledge base. */
  recall: z.boolean(),
  /** Rolling conversation memory per channel. */
  memory: z.boolean(),
  /** How hard the bot thinks: maps to the API effort parameter. */
  effort: z.enum(["low", "medium", "high", "xhigh"]),
});

export const BlueprintSchema = z.object({
  name: z.string().min(1).max(60),
  tagline: z.string().max(140),
  /** The bot's system prompt — its character and rules of engagement. */
  persona: z.string().min(1),
  /** Slash-command prefix namespace, e.g. "atlas" -> /atlas-ask. Empty means no namespace. */
  namespace: z
    .string()
    .regex(/^[a-z0-9-]*$/, "lowercase letters, digits and dashes only")
    .max(20),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  skills: z.array(z.string()),
  mind: MindSchema,
  knowledge: z.array(KnowledgeDocSchema),
});

export type Blueprint = z.infer<typeof BlueprintSchema>;
export type KnowledgeDoc = z.infer<typeof KnowledgeDocSchema>;
export type Mind = z.infer<typeof MindSchema>;

/** The shape the model is asked to produce — no knowledge docs, no ids to invent. */
export const DraftSchema = BlueprintSchema.omit({ knowledge: true });
export type Draft = z.infer<typeof DraftSchema>;

export const DEFAULT_BLUEPRINT: Blueprint = {
  name: "Atlas",
  tagline: "A calm, well-read guide for your server.",
  persona:
    "You are Atlas, a calm and precise guide. You answer from the server's knowledge base when it is relevant, cite what you used, and say plainly when you do not know something. You are warm but never padded — no filler, no disclaimers stacked on disclaimers.",
  namespace: "",
  accent: "#7c5cff",
  skills: ["ai-chat", "rag-knowledge", "think-mode", "idea-engine"],
  mind: { think: true, ideas: true, recall: true, memory: true, effort: "high" },
  knowledge: [],
};

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "bot"
  );
}

/** Slash command name, namespaced when the blueprint asks for it. */
export function commandName(blueprint: Blueprint, base: string): string {
  return blueprint.namespace ? `${blueprint.namespace}-${base}` : base;
}
