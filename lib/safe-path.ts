import path from "node:path";

// Every file the desk reads back from a path stored in the database (a CV, a cover letter, a package folder) has to be
// one the desk wrote itself: under resumes/ or applications/ in the project. A path anywhere else (a typed one, an old
// row, ../.env.local) is refused here, so no download, Gmail attachment or form upload can carry any other file.

const ROOTS = ["resumes", "applications"].map((dir) => path.resolve(/*turbopackIgnore: true*/ dir));

/** The absolute path when it is inside resumes/ or applications/, else null. */
export function safeDeskPath(file: string | null | undefined): string | null {
  if (!file || file.includes("\0")) return null;
  const abs = path.resolve(/*turbopackIgnore: true*/ file);
  const inside = ROOTS.some((root) => {
    const rel = path.relative(root, abs);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
  return inside ? abs : null;
}

/** Same check, throwing: for code that is about to read the file and must not read any other. */
export function requireDeskPath(file: string): string {
  const safe = safeDeskPath(file);
  if (!safe) throw new Error(`Refused to read a file outside resumes/ and applications/: ${path.basename(file)}`);
  return safe;
}
