// Where a posting has to be for the desk to want it: Montréal and its suburbs, the rest of Québec, or remote from Canada.
// One list, read by discovery's SQL (lib/workflow.ts upsertJob) and by the registry when it decides whether a company
// found elsewhere hires interns around here (lib/registry/expand.ts).

/** Greater Montréal and Québec places, as a POSIX / JS regex body (case-insensitive). */
export const QUEBEC_PLACES = [
  "montr",
  "laval",
  "vaudreuil",
  "saint-?laurent",
  "st[ .-]?laurent",
  "qu[eé]bec",
  "quebec",
  "longueuil",
  "dorval",
  "pointe-?claire",
  "kirkland",
  "beaconsfield",
  "lachine",
  "brossard",
  "boucherville",
  "saint-?bruno",
  "st[ .-]?bruno",
  "saint-?hubert",
  "st[ .-]?hubert",
  "mont-?royal",
  "mount[ -]royal",
  "terrebonne",
  "blainville",
  "boisbriand",
  "mirabel",
  "repentigny",
  "varennes",
  "candiac",
  "la prairie",
  "saint-?eustache",
  "sherbrooke",
  "gatineau",
  "trois-?rivi",
  "l[eé]vis",
  "drummondville",
  "saint-?jean-sur-richelieu",
].join("|");

/**
 * Canadian places outside Québec: a "Canada" posting placed there is not one for here. Cities, provinces, and province
 * codes after a comma ("Innisfail, AB, Canada"). Only syntax both JS and Postgres regexes read the same way (no \b).
 */
export const OTHER_CANADA = [
  "toronto|vancouver|calgary|ottawa|mississauga|waterloo|edmonton|winnipeg|markham|burnaby|kitchener|halifax|victoria|regina",
  "saskatoon|oakville|brampton|richmond hill|vaughan|hamilton|london, on",
  "alberta|british columbia|saskatchewan|manitoba|ontario|nova scotia|new brunswick|newfoundland|prince edward",
  ",[ ]*(ab|bc|sk|mb|on|ns|nb|nl|pe|yt|nt|nu)([ ]*,|[ ]*$|[ ]+canada)",
].join("|");

const PLACES_RE = new RegExp(QUEBEC_PLACES, "i");
const CANADA_RE = /canada|remote|anywhere|t[ée]l[ée]travail/i;
const OTHER_RE = new RegExp(OTHER_CANADA, "i");

/** The same rule as discovery's SQL: no place named, remote, a Québec place, or "Canada / remote" with no other city named. */
export function fitsWhere(location: string | null | undefined, workMode?: string | null): boolean {
  const where = (location ?? "").trim();
  if (!where) return true;
  if (workMode === "remote") return true;
  if (PLACES_RE.test(where)) return true;
  return CANADA_RE.test(where) && !OTHER_RE.test(where);
}
