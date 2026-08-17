import { NextResponse } from "next/server";
import { z } from "zod";
import { playgroundReply } from "@/lib/ai";
import { BlueprintSchema } from "@/lib/blueprint";
import { buildChunks, excerpt, search } from "@/lib/rag";

export const runtime = "nodejs";
export const maxDuration = 300;

const RequestSchema = z.object({
  blueprint: BlueprintSchema,
  question: z.string().min(1).max(4000),
  mode: z.enum(["ask", "think", "idea"]).default("ask"),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const { blueprint, question, mode } = parsed.data;

  // Retrieval runs here exactly as it will in the generated bot, so the
  // playground is a real test of the knowledge base rather than a mock.
  const hits = blueprint.mind.recall ? search(question, buildChunks(blueprint.knowledge), 4) : [];

  const result = await playgroundReply({ blueprint, question, hits, mode });

  return NextResponse.json({
    ...result,
    hits: hits.map((hit) => ({
      title: hit.title,
      score: Number(hit.score.toFixed(2)),
      excerpt: excerpt(hit.text),
    })),
  });
}
