import { readFile } from "node:fs/promises";
import { applicationFiles } from "../../../../../lib/attachments";
import { getApplication } from "../../../../../lib/queries";
import { safeDeskPath } from "../../../../../lib/safe-path";

// Serves the two files that go with the email, for anyone who wants them as downloads. The Gmail draft
// attaches them by itself; this is the fallback. Which files these are is decided in lib/attachments.ts.

export const dynamic = "force-dynamic";

function notFound(message: string) {
  return new Response(message, { status: 404 });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await ctx.params;
  if (kind !== "cv" && kind !== "letter" && kind !== "cv-tailored") return notFound("Unknown file");

  const app = await getApplication(id);
  if (!app) return notFound("Application not found");

  if (kind === "cv-tailored") {
    // Only a file the desk wrote (applications/): never another path.
    const tailored = safeDeskPath(app.tailored_cv_path);
    if (!tailored) return notFound("No tailored CV yet");
    try {
      const bytes = await readFile(tailored);
      return new Response(new Uint8Array(bytes), {
        headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="CV - tailored - ${app.company_name.replace(/[^\x20-\x7e]|["\\]/g, "")}.pdf"`, "cache-control": "no-store" },
      });
    } catch {
      return notFound("File is missing on disk");
    }
  }

  const file = (await applicationFiles(app)).find((f) => f.kind === kind);
  if (!file) return notFound(kind === "cv" ? "No resume for this application" : "No cover letter yet");

  let bytes: Buffer;
  try {
    bytes = await readFile(file.path);
  } catch {
    return notFound("File is missing on disk");
  }

  const ascii = file.filename.normalize("NFKD").replace(/[^\x20-\x7e]/g, "");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": file.contentType,
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "cache-control": "no-store",
    },
  });
}
