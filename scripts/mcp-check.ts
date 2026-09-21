// Smoke-test the MCP server over stdio: list tools, call jobs_ranked.
//   npx tsx scripts/mcp-check.ts

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { pool } from "../lib/db";

async function main() {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "mcp/server.ts"],
    cwd: process.cwd(),
    stderr: "pipe",
  });

  const client = new Client({ name: "internship-desk-check", version: "0.1.0" });
  await client.connect(transport);

  const listed = await client.listTools();
  const names = listed.tools.map((t) => t.name).sort();
  console.log(`tools (${names.length}): ${names.join(", ")}`);

  const expected = [
    "add_note",
    "answer_lookup",
    "application_status",
    "applications_by_state",
    "company_profile",
    "followups_due",
    "jobs_ranked",
    "search_jobs",
    "set_application_status",
  ];
  for (const name of expected) {
    if (!names.includes(name)) throw new Error(`missing tool: ${name}`);
  }
  if (names.length !== expected.length) {
    throw new Error(`unexpected tool count ${names.length}, expected ${expected.length}`);
  }

  const ranked = await client.callTool({
    name: "jobs_ranked",
    arguments: { minScore: 70, untrackedOnly: false },
  });
  if (ranked.isError) throw new Error(String(ranked.content));
  const text = Array.isArray(ranked.content)
    ? ranked.content
        .map((block) => ("text" in block ? block.text : ""))
        .join("")
    : "";
  const payload = JSON.parse(text) as {
    jobs: Array<{ id: string; title: string; company: string; score: number }>;
  };
  console.log(`jobs_ranked ≥70 → ${payload.jobs.length} row(s)`);

  for (const job of payload.jobs) {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM jobs WHERE id = $1`,
      [job.id],
    );
    if (Number(rows[0].n) !== 1) {
      throw new Error(`jobs_ranked returned id not in database: ${job.id}`);
    }
  }
  console.log("every ranked row exists in the database.");

  await client.close();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
