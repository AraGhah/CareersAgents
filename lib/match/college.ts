// Who a posting is for, by schooling: a DEC / college (CÉGEP) student first. Every posting is still applied to; this only
// decides the order (lib/auto-apply/select.ts) and is shown next to each posting.
//   college     the posting names CÉGEP, collégial, DEC / AEC, a technique program, or college students
//   open        it names no schooling level
//   university  it asks for a bachelor's / baccalauréat / university program and never mentions college
// The same patterns are used in SQL (Postgres regex) and here; only syntax both read the same way.

export type SchoolLevel = "college" | "open" | "university";

/** Case-insensitive. */
export const COLLEGE_RE_SRC =
  "c[ée]gep|coll[ée]gia(l|le|ux)|niveau coll|dipl[ôo]me d.[ée]tudes coll|techniques? (de l.informatique|informatiques?|en informatique|de l.ing)|stage technique|stagiaire technique|college (student|program|diploma|level)|community college|college ?(or|and|/) ?universit|coll[eè]ge ?(ou|et|/) ?(l.)?universit|[ée]tudiant.{0,4} (au|du|de niveau) coll";
/** Case-sensitive: the acronyms only in capitals ("DEC", never "Dec 2026" or "decision"). */
export const COLLEGE_ACRONYM_SRC = "(^|[^A-Za-z])(DEC|AEC|DCS)([^A-Za-z]|$)";
/** Case-insensitive. */
export const UNIVERSITY_RE_SRC =
  "baccalaur[ée]at|bachelor|undergraduate|universit[ée]|universitaire|university|master.?s (degree|student|program)|ma[iî]trise|ph\\.?d|graduate (student|program|degree)";

const COLLEGE_RE = new RegExp(COLLEGE_RE_SRC, "i");
const COLLEGE_ACRONYM_RE = new RegExp(COLLEGE_ACRONYM_SRC);
const UNIVERSITY_RE = new RegExp(UNIVERSITY_RE_SRC, "i");

export function schoolLevel(title: string, description: string | null): SchoolLevel {
  const text = `${title}\n${description ?? ""}`;
  if (COLLEGE_RE.test(text) || COLLEGE_ACRONYM_RE.test(text)) return "college";
  if (UNIVERSITY_RE.test(text)) return "university";
  return "open";
}

/** The SQL expression giving 0 (college), 1 (open) or 2 (university) for a job aliased `j`; parameters $a $b $c in order. */
export function schoolRankSql(a: number, b: number, c: number): string {
  const text = `(j.title || ' ' || COALESCE(j.description, ''))`;
  return `CASE WHEN ${text} ~* $${a} OR ${text} ~ $${b} THEN 0 WHEN ${text} ~* $${c} THEN 2 ELSE 1 END`;
}

export const SCHOOL_LEVEL_LABEL: Record<SchoolLevel, string> = { college: "cégep", open: "ouvert", university: "université" };
