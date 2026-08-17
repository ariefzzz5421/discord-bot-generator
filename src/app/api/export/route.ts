import JSZip from "jszip";
import { NextResponse } from "next/server";
import { BlueprintSchema, slugify } from "@/lib/blueprint";
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

  const blueprint = parsed.data;
  const root = slugify(blueprint.name);
  const zip = new JSZip();
  const folder = zip.folder(root);

  if (!folder) {
    return NextResponse.json({ error: "Could not build the archive." }, { status: 500 });
  }

  for (const file of generateProject(blueprint)) {
    folder.file(file.path, file.content);
  }

  const archive = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });

  return new NextResponse(new Uint8Array(archive), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${root}-bot.zip"`,
      "content-length": String(archive.byteLength),
      "cache-control": "no-store",
    },
  });
}
