import { NextResponse } from "next/server";
import { z } from "zod";
import { draftBlueprint } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 120;

const RequestSchema = z.object({
  brief: z.string().min(3, "Describe the bot in a little more detail.").max(4000),
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

  const result = await draftBlueprint(parsed.data.brief);
  return NextResponse.json(result);
}
