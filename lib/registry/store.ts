// The careers-board registry in the database (schema-v17.sql): which company has which board, when each was read, and
// the companies whose own site has not been searched for one yet.

import employersFile from "../../employers.json";
import { pool } from "../db";
import { nameKey, type EmployerBoard } from "../apply/boards";
import { registryKey, type RegistryBoard } from "./board-ref";

export type BoardRow = {
  id: string;
  company_id: string;
  company_name: string;
  platform: string;
  key: string;
  config: RegistryBoard["config"];
  careers_url: string | null;
  last_crawled_at: Date | null;
  fail_count: number;
};

/** After this many failed reads in a row, over at least a week, a board is retired (kept, no longer read). */
const RETIRE_AFTER_FAILS = 5;

/** schema-v17.sql applied? Discovery keeps working on the companies table without it. */
export async function registryReady(): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(`SELECT to_regclass('career_boards') IS NOT NULL AS ok`);
  return rows[0].ok;
}

/** Names a feed puts where the employer's should be: never a company of their own. */
const NOT_A_COMPANY = /^(confidential|anonymous|undisclosed|private|n\/?a|unknown)$|\bconfidential\b|\bsandbox\b|^jobs? in\b|jobgether|\bstaffing\b|\brecruit(ing|ment|ers?)\b/i;

export function isPlaceholderCompany(name: string): boolean {
  return !nameKey(name) || NOT_A_COMPANY.test(name.trim());
}

/**
 * The desk's companies by comparable name: "Cadence Design Systems Inc." and "Cadence Design Systems" are one, and so are
 * "Coveo Solutions Inc." and a known "Coveo" (a known name of 4+ letters followed by more words), and an alias
 * employers.json gives a company ("RTX" for Pratt & Whitney).
 */
export class CompanyIndex {
  private byKey = new Map<string, string>();

  static async load(): Promise<CompanyIndex> {
    const idx = new CompanyIndex();
    const { rows } = await pool.query<{ id: string; name: string }>(`SELECT id, name FROM companies`);
    for (const r of rows) idx.byKey.set(nameKey(r.name), r.id);
    for (const e of (employersFile as { employers: EmployerEntry[] }).employers) {
      const id = idx.byKey.get(nameKey(e.name));
      if (id) for (const alias of e.aliases ?? []) if (!idx.byKey.has(nameKey(alias))) idx.byKey.set(nameKey(alias), id);
    }
    return idx;
  }

  find(name: string): string | null {
    const key = nameKey(name);
    const exact = this.byKey.get(key);
    if (exact) return exact;
    // "coveo solutions" → a known "coveo"; the longest known name that starts it wins.
    let best: { len: number; id: string } | null = null;
    for (const [k, id] of this.byKey) {
      if (k.length >= 4 && key.startsWith(`${k} `) && (!best || k.length > best.len)) best = { len: k.length, id };
    }
    return best?.id ?? null;
  }

  /** The company with this name, created (with where it came from) when the desk has none. */
  async ensure(name: string, via: string, website: string | null = null): Promise<{ id: string; created: boolean }> {
    const known = this.find(name);
    if (known) return { id: known, created: false };
    const { rows } = await pool.query<{ id: string; created: boolean }>(
      `INSERT INTO companies (name, website, is_target, discovered_via, discovered_at)
       VALUES ($1, $2, false, $3, now())
       ON CONFLICT (name) DO UPDATE SET website = COALESCE(companies.website, EXCLUDED.website)
       RETURNING id, (xmax = 0) AS created`,
      [name.trim(), website, via],
    );
    this.byKey.set(nameKey(name), rows[0].id);
    return rows[0];
  }
}

/** The company a board is already registered to, if any: the same board found again is the same company. */
export async function boardOwner(board: RegistryBoard): Promise<string | null> {
  const { rows } = await pool.query<{ company_id: string }>(`SELECT company_id FROM career_boards WHERE key = $1`, [registryKey(board)]);
  return rows[0]?.company_id ?? null;
}

/**
 * Adds a board, or brings a retired one back. A careers page is not added for a company that already has a real board:
 * the board lists the same jobs, better. Returns true when the board is new.
 */
export async function registerBoard(companyId: string, board: RegistryBoard, via: string, careersUrl: string | null = null): Promise<boolean> {
  if (board.platform === "careers-page") {
    const { rows } = await pool.query(`SELECT 1 FROM career_boards WHERE company_id = $1 AND platform <> 'careers-page' AND status = 'active'`, [companyId]);
    if (rows.length) return false;
  }
  const { rows } = await pool.query<{ inserted: boolean }>(
    `INSERT INTO career_boards (company_id, platform, key, config, careers_url, discovered_via)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (key) DO UPDATE
        SET status = 'active',
            fail_count = CASE WHEN career_boards.status = 'retired' THEN 0 ELSE career_boards.fail_count END,
            careers_url = COALESCE(career_boards.careers_url, EXCLUDED.careers_url)
     RETURNING (xmax = 0) AS inserted`,
    [companyId, board.platform, registryKey(board), JSON.stringify(board.config), careersUrl, via],
  );
  if (rows[0].inserted && board.platform !== "careers-page") {
    // A company that now has a real board does not need its careers page read as well.
    await pool.query(`UPDATE career_boards SET status = 'retired', error = 'replaced by a job board' WHERE company_id = $1 AND platform = 'careers-page'`, [companyId]);
  }
  return rows[0].inserted;
}

/** Active boards not read in the last `maxAgeHours`, the never-read ones first. */
export async function dueBoards(maxAgeHours: number): Promise<BoardRow[]> {
  const { rows } = await pool.query<BoardRow>(
    `SELECT b.id, b.company_id, c.name AS company_name, b.platform, b.key, b.config, b.careers_url, b.last_crawled_at, b.fail_count
       FROM career_boards b JOIN companies c ON c.id = b.company_id
      WHERE b.status = 'active'
        AND (b.last_crawled_at IS NULL OR b.last_crawled_at < now() - make_interval(hours => $1))
      ORDER BY b.last_crawled_at NULLS FIRST, c.is_target DESC, c.name`,
    [maxAgeHours],
  );
  return rows;
}

export async function recordCrawl(id: string, r: { ok: true; jobs: number; matches: number } | { ok: false; error: string }): Promise<void> {
  if (r.ok) {
    await pool.query(
      `UPDATE career_boards SET last_crawled_at = now(), last_ok_at = now(), last_jobs = $2, last_matches = $3, fail_count = 0, error = NULL WHERE id = $1`,
      [id, r.jobs, r.matches],
    );
    return;
  }
  await pool.query(
    `UPDATE career_boards
        SET last_crawled_at = now(), fail_count = fail_count + 1, error = $2,
            status = CASE WHEN fail_count + 1 >= $3 AND COALESCE(last_ok_at, first_seen_at) < now() - interval '7 days'
                          THEN 'retired' ELSE status END
      WHERE id = $1`,
    [id, r.error.slice(0, 500), RETIRE_AFTER_FAILS],
  );
}

export type LookupCompany = { id: string; name: string; website: string | null };

/**
 * Companies with no active board whose own site has not been searched for one in two weeks: the ones that still have
 * open postings first (the role is waiting), then the newest.
 */
export async function companiesToLookUp(limit: number): Promise<LookupCompany[]> {
  const { rows } = await pool.query<LookupCompany>(
    `SELECT c.id, c.name, c.website
       FROM companies c
      WHERE NOT EXISTS (SELECT 1 FROM career_boards b WHERE b.company_id = c.id AND b.status = 'active')
        AND (c.careers_checked_at IS NULL OR c.careers_checked_at < now() - interval '14 days')
      ORDER BY EXISTS (SELECT 1 FROM jobs j WHERE j.company_id = c.id AND j.closed_at IS NULL) DESC,
               c.discovered_at DESC NULLS LAST, c.name
      LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function markCareersChecked(companyId: string, careersUrl: string | null, note: string, website: string | null): Promise<void> {
  await pool.query(
    `UPDATE companies
        SET careers_checked_at = now(), careers_note = $3,
            careers_url = COALESCE($2, careers_url), website = COALESCE(website, $4)
      WHERE id = $1`,
    [companyId, careersUrl, note.slice(0, 500), website],
  );
}

type EmployerEntry = { name: string; aliases?: string[] } & EmployerBoard;

/**
 * The boards the desk already knew before the registry: the companies' own ats/board_token (seed/companies.ts) and the
 * verified employer job systems of employers.json. Run on every daily pass; a board already there is left alone.
 */
export async function backfillRegistry(index: CompanyIndex): Promise<{ boards: number; companies: number }> {
  let boards = 0;
  let companies = 0;
  const { rows } = await pool.query<{ id: string; ats: string; board_token: string }>(
    `SELECT id, ats, board_token FROM companies WHERE board_token IS NOT NULL AND ats IN ('greenhouse', 'lever', 'workable', 'ashby')`,
  );
  for (const r of rows) {
    const board = { platform: r.ats, config: { token: r.board_token } } as RegistryBoard;
    if (await registerBoard(r.id, board, "seed")) boards += 1;
  }
  for (const e of (employersFile as { employers: EmployerEntry[] }).employers) {
    const known = [e.name, ...(e.aliases ?? [])].map((n) => index.find(n)).find(Boolean) ?? null;
    const company = known ? { id: known, created: false } : await index.ensure(e.name, "employers.json");
    if (company.created) companies += 1;
    const config = { ...e } as Partial<EmployerEntry>;
    delete config.name;
    delete config.aliases;
    const board = { platform: e.ats, config: config as EmployerBoard } as RegistryBoard;
    if (await registerBoard(company.id, board, "employers.json")) boards += 1;
  }
  return { boards, companies };
}

export type RegistryStats = { active: number; retired: number; companies: number; byPlatform: Array<{ platform: string; n: number }> };

export async function registryStats(): Promise<RegistryStats> {
  const { rows } = await pool.query<{ platform: string; status: string; n: string }>(
    `SELECT platform, status, count(*)::text AS n FROM career_boards GROUP BY 1, 2`,
  );
  const { rows: c } = await pool.query<{ n: string }>(`SELECT count(DISTINCT company_id)::text AS n FROM career_boards WHERE status = 'active'`);
  const by = new Map<string, number>();
  let active = 0;
  let retired = 0;
  for (const r of rows) {
    if (r.status === "active") {
      active += Number(r.n);
      by.set(r.platform, (by.get(r.platform) ?? 0) + Number(r.n));
    } else retired += Number(r.n);
  }
  return {
    active,
    retired,
    companies: Number(c[0].n),
    byPlatform: [...by.entries()].map(([platform, n]) => ({ platform, n })).sort((a, b) => b.n - a.n),
  };
}

export type RecentCompany = { id: string; name: string; via: string | null; discovered_at: Date; boards: string | null; open_jobs: number };

/** Companies that entered the desk in the last `days`, with their boards and open postings around here. */
export async function recentCompanies(days: number, limit = 60): Promise<RecentCompany[]> {
  const { rows } = await pool.query<RecentCompany>(
    `SELECT c.id, c.name, c.discovered_via AS via, c.discovered_at,
            (SELECT string_agg(DISTINCT b.platform, ', ') FROM career_boards b WHERE b.company_id = c.id AND b.status = 'active') AS boards,
            (SELECT count(*)::int FROM jobs j WHERE j.company_id = c.id AND j.closed_at IS NULL) AS open_jobs
       FROM companies c
      WHERE c.discovered_at > now() - make_interval(days => $1)
      ORDER BY c.discovered_at DESC, c.name
      LIMIT $2`,
    [days, limit],
  );
  return rows;
}
