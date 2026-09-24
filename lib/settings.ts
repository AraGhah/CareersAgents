import { pool } from "./db";
import { isInternshipCategory, type InternshipCategory } from "./internship-category";

export async function getSetting(key: string): Promise<string | null> {
  const { rows } = await pool.query<{ value: string | null }>(
    `SELECT value FROM settings WHERE key = $1`,
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  );
}

const ACTIVE_CATEGORY_KEY = "active_category";

/** The "currently targeting" internship category — a default/bias for the
 *  jobs list and discovery, never a hard filter. Null means "no preference." */
export async function getActiveCategory(): Promise<InternshipCategory | null> {
  const value = await getSetting(ACTIVE_CATEGORY_KEY);
  return isInternshipCategory(value) ? value : null;
}

export async function setActiveCategory(category: InternshipCategory | null): Promise<void> {
  await setSetting(ACTIVE_CATEGORY_KEY, category);
}
