import { readFile } from "node:fs/promises";
import { pool } from "../../../../lib/db";
import { safeDeskPath } from "../../../../lib/safe-path";

// The screenshot a form run took once the form was filled, for /approvals: what the employer's form looks like before you
// approve it. Only a file the desk wrote (applications/) is ever served.

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  if (!UUID.test(runId)) return new Response("Unknown run", { status: 404 });
  const { rows } = await pool.query<{ screenshot_path: string | null }>(`SELECT screenshot_path FROM portal_runs WHERE id = $1`, [runId]);
  const file = safeDeskPath(rows[0]?.screenshot_path);
  if (!file || !file.toLowerCase().endsWith(".png")) return new Response("No screenshot", { status: 404 });
  try {
    const bytes = await readFile(file);
    return new Response(new Uint8Array(bytes), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
  } catch {
    return new Response("Screenshot missing on disk", { status: 404 });
  }
}
