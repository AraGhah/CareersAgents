// One MCP server for the desk. Read tools plus two reversible writes.
// Run:  npx tsx mcp/server.ts
// Never exposes submit, send, or email.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { pool } from "../lib/db";
import {
  appendApplicationNote,
  setApplicationStatus,
} from "../lib/queries";
import { APPLICATION_STATUSES, type ApplicationStatus } from "../lib/types";

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

const SCORE_CTE = `
  WITH latest AS (
    SELECT job_id, MAX(scored_at) AS scored_at
      FROM job_scores
     GROUP BY job_id
  ),
  totals AS (
    SELECT s.job_id,
           SUM(s.raw_value * s.weight) AS score,
           BOOL_OR(s.component = 'location' AND s.raw_value = 0)
             OR BOOL_OR(s.component = 'timing' AND s.raw_value = 0) AS gated
      FROM job_scores s
      JOIN latest l ON l.job_id = s.job_id AND l.scored_at = s.scored_at
     GROUP BY s.job_id
  )
`;

const server = new McpServer({
  name: "internship-desk",
  version: "1.0.0",
});

server.registerTool(
  "jobs_ranked",
  {
    description:
      "Open postings ranked by the latest match score. Scores are 0-100. Skipped (location/timing gate) rows are excluded.",
    inputSchema: {
      minScore: z
        .number()
        .min(0)
        .max(100)
        .default(70)
        .describe("Minimum score 0-100. Default 70."),
      untrackedOnly: z
        .boolean()
        .default(false)
        .describe("If true, only postings with no application row yet."),
    },
  },
  async ({ minScore, untrackedOnly }) => {
    const threshold = minScore / 100;
    const { rows } = await pool.query(
      `${SCORE_CTE}
       SELECT j.id, j.title, c.name AS company, j.url, j.location, j.workplace_type,
              ROUND(t.score * 100) AS score,
              a.id AS application_id, a.status
         FROM jobs j
         JOIN companies c ON c.id = j.company_id
         JOIN totals t ON t.job_id = j.id
         LEFT JOIN applications a ON a.job_id = j.id
        WHERE j.closed_at IS NULL
          AND t.gated IS NOT TRUE
          AND t.score >= $1
          AND ($2::boolean = false OR a.id IS NULL)
        ORDER BY t.score DESC, c.name, j.title`,
      [threshold, untrackedOnly],
    );
    return ok({ minScore, untrackedOnly, count: rows.length, jobs: rows });
  },
);

server.registerTool(
  "application_status",
  {
    description: "One application by id, with the job and company fields.",
    inputSchema: {
      applicationId: z.string().uuid().describe("applications.id"),
    },
  },
  async ({ applicationId }) => {
    const { rows } = await pool.query(
      `SELECT a.id, a.status, a.submitted_at, a.resume_path, a.cover_letter_path, a.notes,
              j.title, j.url, j.location, j.workplace_type,
              c.name AS company, c.city AS company_city, c.website AS company_website
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         JOIN companies c ON c.id = j.company_id
        WHERE a.id = $1`,
      [applicationId],
    );
    if (!rows[0]) return fail(`no application ${applicationId}`);
    return ok(rows[0]);
  },
);

server.registerTool(
  "applications_by_state",
  {
    description: "Applications filtered by status. Omit status to list all, grouped counts included.",
    inputSchema: {
      status: z
        .enum(APPLICATION_STATUSES)
        .optional()
        .describe("Optional status filter, e.g. submitted or interview."),
    },
  },
  async ({ status }) => {
    const params: unknown[] = [];
    let where = "";
    if (status) {
      params.push(status);
      where = `WHERE a.status = $1`;
    }
    const { rows } = await pool.query(
      `SELECT a.id, a.status, a.submitted_at, j.title, c.name AS company, j.url
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         JOIN companies c ON c.id = j.company_id
         ${where}
        ORDER BY a.status, COALESCE(a.submitted_at, j.first_seen_at) DESC`,
      params,
    );
    const counts: Record<string, number> = {};
    for (const row of rows) {
      const key = String((row as { status: string }).status);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return ok({ status: status ?? "all", counts, applications: rows });
  },
);

server.registerTool(
  "company_profile",
  {
    description: "Company row plus open job count. Match by exact name (case insensitive) or id.",
    inputSchema: {
      name: z.string().optional().describe("Company name, case insensitive."),
      id: z.string().uuid().optional().describe("companies.id"),
    },
  },
  async ({ name, id }) => {
    if (!name && !id) return fail("pass name or id");
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.website, c.ats, c.board_token, c.city, c.is_target, c.notes,
              count(j.id) FILTER (WHERE j.closed_at IS NULL) AS open_jobs
         FROM companies c
         LEFT JOIN jobs j ON j.company_id = c.id
        WHERE ($1::uuid IS NOT NULL AND c.id = $1)
           OR ($2::text IS NOT NULL AND lower(c.name) = lower($2))
        GROUP BY c.id`,
      [id ?? null, name ?? null],
    );
    if (!rows[0]) return fail("company not found");
    return ok(rows[0]);
  },
);

server.registerTool(
  "answer_lookup",
  {
    description:
      "Look up the answer bank. Pass a key for one row, or a query string matched against keys.",
    inputSchema: {
      key: z.string().optional().describe("Exact answers.key, e.g. available_from."),
      query: z.string().optional().describe("Substring match on key when key is omitted."),
    },
  },
  async ({ key, query }) => {
    if (key) {
      const { rows } = await pool.query(
        `SELECT key, category, answer_en, answer_fr, updated_at
           FROM answers WHERE key = $1`,
        [key],
      );
      if (!rows[0]) return fail(`no answer for key ${key}`);
      return ok(rows[0]);
    }
    const needle = query?.trim() || "";
    const { rows } = await pool.query(
      `SELECT key, category, answer_en, answer_fr, updated_at
         FROM answers
        WHERE $1 = '' OR key ILIKE '%' || $1 || '%'
        ORDER BY CASE category WHEN 'green' THEN 0 WHEN 'yellow' THEN 1 ELSE 2 END, key`,
      [needle],
    );
    return ok({ query: needle || null, count: rows.length, answers: rows });
  },
);

server.registerTool(
  "followups_due",
  {
    description: "Follow-up rows due on or before a date (default today), still pending or drafted.",
    inputSchema: {
      onOrBefore: z
        .string()
        .optional()
        .describe("YYYY-MM-DD. Defaults to today."),
    },
  },
  async ({ onOrBefore }) => {
    const day = onOrBefore ?? new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(
      `SELECT f.id, f.due_on, f.state, f.gmail_draft_id,
              a.id AS application_id, a.status AS application_status,
              j.title, c.name AS company
         FROM followups f
         JOIN applications a ON a.id = f.application_id
         JOIN jobs j ON j.id = a.job_id
         JOIN companies c ON c.id = j.company_id
        WHERE f.due_on <= $1::date
          AND f.state IN ('pending', 'drafted')
        ORDER BY f.due_on, c.name`,
      [day],
    );
    return ok({ onOrBefore: day, count: rows.length, followups: rows });
  },
);

server.registerTool(
  "search_jobs",
  {
    description: "Search open (or all) jobs by title or company name.",
    inputSchema: {
      q: z.string().min(1).describe("Substring matched against title and company."),
      includeClosed: z.boolean().default(false),
    },
  },
  async ({ q, includeClosed }) => {
    const { rows } = await pool.query(
      `${SCORE_CTE}
       SELECT j.id, j.title, c.name AS company, j.url, j.location, j.closed_at,
              ROUND(t.score * 100) AS score, a.id AS application_id, a.status
         FROM jobs j
         JOIN companies c ON c.id = j.company_id
         LEFT JOIN totals t ON t.job_id = j.id
         LEFT JOIN applications a ON a.job_id = j.id
        WHERE (j.title ILIKE '%' || $1 || '%' OR c.name ILIKE '%' || $1 || '%')
          AND ($2::boolean = true OR j.closed_at IS NULL)
        ORDER BY t.score DESC NULLS LAST, c.name, j.title
        LIMIT 50`,
      [q, includeClosed],
    );
    return ok({ q, includeClosed, count: rows.length, jobs: rows });
  },
);

server.registerTool(
  "set_application_status",
  {
    description:
      "Update an application status. Reversible. Does not submit anything externally.",
    inputSchema: {
      applicationId: z.string().uuid(),
      status: z.enum(APPLICATION_STATUSES),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async ({ applicationId, status }) => {
    await setApplicationStatus(applicationId, status as ApplicationStatus);
    const { rows } = await pool.query(
      `SELECT id, status, submitted_at FROM applications WHERE id = $1`,
      [applicationId],
    );
    if (!rows[0]) return fail(`no application ${applicationId}`);
    return ok(rows[0]);
  },
);

server.registerTool(
  "add_note",
  {
    description:
      "Append a dated note to an application. Reversible by editing notes in the app. Does not email or submit.",
    inputSchema: {
      applicationId: z.string().uuid(),
      note: z.string().min(1).describe("Plain text to append."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ applicationId, note }) => {
    try {
      const notes = await appendApplicationNote(applicationId, note);
      return ok({ applicationId, notes });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("internship-desk MCP server on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
