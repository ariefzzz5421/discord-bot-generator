import { NextResponse } from "next/server";
import { BlueprintSchema } from "@/lib/blueprint";
import { generateProject } from "@/lib/codegen";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = BlueprintSchema.safeParse((body as { blueprint?: unknown })?.blueprint);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid blueprint." }, { status: 400 });
  }

  const files = generateProject(parsed.data);

  return NextResponse.json({
    files: files.map((file) => ({
      path: file.path,
      content: file.content,
      lines: file.content.split("\n").length,
      bytes: Buffer.byteLength(file.content, "utf8"),
    })),
    totalBytes: files.reduce((sum, file) => sum + Buffer.byteLength(file.content, "utf8"), 0),
  });
}
