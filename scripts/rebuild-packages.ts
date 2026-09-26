// Rebuilds the stored letter, email and PDF for every application that has not been sent yet,
// so they all follow the current templates, and refreshes stored outreach drafts the same way.
//   npx tsx scripts/rebuild-packages.ts                 dry run: says what it would do, changes nothing
//   npx tsx scripts/rebuild-packages.ts --apply         backs up applications/, then rebuilds
//   npx tsx scripts/rebuild-packages.ts --only sap      limit to companies whose name contains "sap"
//   npx tsx scripts/rebuild-packages.ts --apply --backup applications/_backup-...   reuse an earlier backup
//
// What it leaves alone, and says so:
//   - applications already sent (applied, follow-up, interview, accepted, rejected, withdrawn),
//     because the files record what was actually sent
//   - letters or emails that do not look like generator output (edited by hand)
//   - outreach drafts that already exist in Gmail, or were sent: the text there cannot be changed from here
// A company fact you typed is kept as written. Letters are written in the language of the posting, so a
// French posting that was built in English switches (and gets the French CV). Everything replaced is
// backed up first, to applications/_backup-<time>/.

import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectCategories } from "../lib/category";
import { pool } from "../lib/db";
import { detectLetterLang, parseLinks, usableCompanyFact, type LetterLang } from "../lib/letter";
import { buildApplicationPackage, buildPackageFromDossier, loadApplicantContact, projectsForCategories } from "../lib/package";
import { buildPersonalizedOutreach, type OutreachDraftRow } from "../lib/outreach";
import { getApplication, listApplications, updateApplicationFields } from "../lib/queries";
import { getLatestDossier } from "../lib/research";

const APPLY = process.argv.includes("--apply");
const ONLY = process.argv.find((a, i) => process.argv[i - 1] === "--only")?.toLowerCase();
const SENT = new Set(["applied", "followup", "interview", "accepted", "rejected", "withdrawn"]);

/** Wording only the generators produce, from before and after the templates changed. */
const GENERATED = [
  /Through my studies and personal projects, I have developed practical experience/,
  /Par mes études et mes projets personnels, j’ai développé une expérience pratique/,
  /Through my coursework and personal projects, I have gained experience/,
  /Par mes cours et mes projets personnels, j’ai acquis de l’expérience/,
  /That's specifically what drew me to apply here/,
  /C’est précisément ce qui m’a donné envie de postuler/,
  /I am reaching out regarding the/,
  /Je vous écris au sujet du poste/,
];

async function readOrNull(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

type StoredMeta = { companyFact?: string; companyFactSource?: string; companyFactVerified?: boolean };

async function applicantLinks(lang: LetterLang): Promise<string[]> {
  const { rows } = await pool.query<{ answer_en: string | null; answer_fr: string | null }>(
    `SELECT answer_en, answer_fr FROM answers WHERE key = 'links'`,
  );
  const raw = lang === "fr" ? (rows[0]?.answer_fr ?? rows[0]?.answer_en) : (rows[0]?.answer_en ?? rows[0]?.answer_fr);
  return parseLinks(raw ?? null);
}

async function rebuildPackages(backupDir: string) {
  const apps = await listApplications();
  const counts = { rebuilt: 0, alreadySent: 0, edited: 0, noPackage: 0, failed: 0 };

  for (const listed of apps) {
    if (ONLY && !listed.company_name.toLowerCase().includes(ONLY)) continue;
    const label = `${listed.company_name} | ${listed.title}`;
    if (SENT.has(listed.status)) {
      counts.alreadySent += 1;
      console.log(`  keep  ${label} (${listed.status})`);
      continue;
    }
    if (!listed.cover_letter_path) {
      counts.noPackage += 1;
      console.log(`  skip  ${label} (no package yet: build it from the application page)`);
      continue;
    }

    const dir = path.dirname(listed.cover_letter_path);
    // The language the files were written in, and the one the posting calls for now (the detector was
    // fixed: plainly French titles used to come out English). When they differ, the old files go.
    const storedLang: LetterLang = /cover-letter\.fr\.pdf$/.test(listed.cover_letter_path) ? "fr" : "en";
    const lang = detectLetterLang(listed.title, listed.description);
    // Applications for the same posting share one folder. If a sibling was already rebuilt in the new
    // language, the old-language files are gone and the new ones are what is there to read.
    const read = async (base: string) =>
      (await readOrNull(path.join(dir, `${base}.${storedLang}.txt`))) ??
      (await readOrNull(path.join(dir, `${base}.${lang}.txt`)));
    const letter = await read("cover-letter");
    const email = await read("outreach-email");
    const meta = JSON.parse((await readOrNull(path.join(dir, "checklist.json"))) ?? "{}") as StoredMeta;

    const generated = (text: string | null) => text !== null && GENERATED.some((re) => re.test(text));
    if (!generated(letter) || !generated(email)) {
      counts.edited += 1;
      console.log(`  KEEP  ${label}: does not look like generator output (edited by hand?), left untouched`);
      continue;
    }

    // A fact typed in the form is kept. Old packages did not record that, so a stored fact that is
    // usable, non-empty and different from what the research found is treated as typed.
    const app = (await getApplication(listed.id))!;
    const dossier = await getLatestDossier(app.company_id, app.id);
    const stored = meta.companyFact?.trim() ?? "";
    const typed =
      meta.companyFactVerified === true ||
      (meta.companyFactVerified === undefined &&
        stored !== "" &&
        stored !== (dossier?.company_fact ?? "").trim() &&
        usableCompanyFact(stored, { lang, verified: true }) !== null &&
        !/\bis hiring for\b|\brecrute pour\b/i.test(stored));

    console.log(`  ${APPLY ? "build" : "would build"}  ${label} [${storedLang === lang ? lang : `${storedLang} → ${lang}`}]${typed ? ` (keeps your typed fact: "${stored.slice(0, 50)}…")` : ""}`);
    if (!APPLY) {
      counts.rebuilt += 1;
      continue;
    }

    try {
      // Back up each folder once: a second application sharing it must not overwrite the original copy.
      const backupOfDir = path.join(backupDir, path.basename(dir));
      if (!existsSync(backupOfDir)) await cp(dir, backupOfDir, { recursive: true });
      let builtDir: string;
      if (typed) {
        const result = await buildApplicationPackage({
          app,
          companyFact: stored,
          companyFactSource: meta.companyFactSource ?? app.company_website ?? app.url,
          companyFactVerified: true,
          lang,
          checkLinks: false,
        });
        await updateApplicationFields(app.id, {
          notes: app.notes,
          resumePath: result.resumePath ?? app.resume_path,
          coverLetterPath: result.pdfPath,
          resumeId: result.resumeId,
        });
        builtDir = result.dir;
      } else {
        const result = await buildPackageFromDossier({ app, dossier, lang, checkLinks: false, force: true });
        builtDir = result!.dir;
      }

      if (path.normalize(builtDir) !== path.normalize(dir)) {
        // The package has its own folder now. The old one goes once no application points into it
        // (its contents were backed up above); a sent application sharing it keeps it.
        const stillUsed = (await listApplications()).some(
          (a) => a.cover_letter_path && path.normalize(path.dirname(a.cover_letter_path)) === path.normalize(dir),
        );
        if (!stillUsed) await rm(dir, { recursive: true, force: true });
      } else if (storedLang !== lang) {
        for (const file of [`cover-letter.${storedLang}.txt`, `cover-letter.${storedLang}.pdf`, `outreach-email.${storedLang}.txt`]) {
          await rm(path.join(dir, file), { force: true });
        }
      }
      counts.rebuilt += 1;
    } catch (err) {
      counts.failed += 1;
      console.log(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return counts;
}

/** Refreshes stored outreach drafts that nothing outside this database depends on. */
async function refreshDrafts(backupDir: string) {
  const { rows } = await pool.query<OutreachDraftRow>(
    `SELECT id, application_id, contact_id, resume_id, dossier_id, kind, lang, to_email, subject, body,
            gmail_draft_id, created_at, sent_detected_at, sent_at, approved_at
       FROM outreach_drafts
      WHERE kind <> 'followup'
      ORDER BY created_at`,
  );
  const counts = { refreshed: 0, kept: 0 };
  const before: OutreachDraftRow[] = [];

  for (const row of rows) {
    const app = await getApplication(row.application_id);
    if (!app || (ONLY && !app.company_name.toLowerCase().includes(ONLY))) continue;
    const label = `${app.company_name} | ${row.to_email}`;
    if (row.gmail_draft_id || row.sent_at || row.sent_detected_at || SENT.has(app.status)) {
      counts.kept += 1;
      console.log(`  keep  draft ${label}: ${row.gmail_draft_id ? "already a Gmail draft, delete it there and use the Gmail button" : "sent"}`);
      continue;
    }

    const lang = row.lang;
    const contact = row.contact_id
      ? (await pool.query<{ name: string | null }>(`SELECT name FROM contacts WHERE id = $1`, [row.contact_id])).rows[0]
      : undefined;
    const applicant = await loadApplicantContact(lang);
    const crafted = buildPersonalizedOutreach({
      app,
      dossier: await getLatestDossier(app.company_id, app.id),
      projects: await projectsForCategories(detectCategories(app.title, app.description)),
      fullName: applicant.fullName,
      availability: applicant.availability,
      email: applicant.email,
      phone: applicant.phone,
      city: applicant.city,
      links: await applicantLinks(lang),
      recipientName: contact?.name ?? null,
      lang: lang ?? detectLetterLang(app.title, app.description),
      kind: row.kind,
    });

    console.log(`  ${APPLY ? "update" : "would update"}  draft ${label}${row.approved_at ? " (approval cleared: the text changed, so it needs a fresh look)" : ""}`);
    if (APPLY) {
      before.push(row);
      await pool.query(
        `UPDATE outreach_drafts
            SET subject = $2, body = $3, approved_at = NULL, approved_by = NULL
          WHERE id = $1`,
        [row.id, crafted.subject, crafted.body],
      );
    }
    counts.refreshed += 1;
  }
  // Keep the first record of the drafts as they were; a later run would only see the refreshed ones.
  const draftBackup = path.join(backupDir, "outreach-drafts-before.json");
  if (APPLY && before.length && !existsSync(draftBackup)) {
    await writeFile(draftBackup, JSON.stringify(before, null, 2), "utf8");
  }
  return counts;
}

async function main() {
  console.log(APPLY ? "APPLY: rebuilding for real\n" : "DRY RUN: nothing is changed (add --apply to do it)\n");
  // --backup <dir> reuses an earlier backup (existing folders in it are never overwritten).
  const reuse = process.argv.find((a, i) => process.argv[i - 1] === "--backup");
  const backupDir = reuse ?? path.join("applications", `_backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  if (APPLY) await mkdir(backupDir, { recursive: true });

  console.log("Letters, emails and PDFs");
  const packages = await rebuildPackages(backupDir);
  console.log("\nStored outreach drafts");
  const drafts = await refreshDrafts(backupDir);

  console.log(
    `\n${packages.rebuilt} package(s) ${APPLY ? "rebuilt" : "to rebuild"}, ${packages.alreadySent} already sent (kept), ${packages.edited} look hand-edited (kept), ${packages.noPackage} without a package, ${packages.failed} failed.`,
  );
  console.log(`${drafts.refreshed} draft(s) ${APPLY ? "refreshed" : "to refresh"}, ${drafts.kept} kept.`);
  if (APPLY) console.log(`Backup of the old files: ${backupDir}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
