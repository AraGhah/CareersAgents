import { detectCategories } from "../lib/category";
import { pool } from "../lib/db";
import { detectLetterLang } from "../lib/letter";
import { projectsForCategories } from "../lib/package";
import { listApplications, listContactsForCompany } from "../lib/queries";
import { buildPersonalizedOutreach, createOutreachDraft } from "../lib/outreach";
import { researchCompanyForApplication } from "../lib/research";
import { getActiveSkills, listResumes, resolveResumeForJob } from "../lib/resumes";

async function main() {
  const resumes = await listResumes();
  const skills = await getActiveSkills();
  console.log(
    "resumes",
    resumes.map((r) => ({
      lang: r.language,
      active: r.is_active,
      skills: r.profile_json?.skills?.slice(0, 8),
    })),
  );
  console.log("active skills", skills.length, skills.slice(0, 12).join(", "));

  const apps = await listApplications();
  console.log("applications", apps.length);
  if (!apps[0]) {
    await pool.end();
    return;
  }

  const app = apps[0];
  console.log("researching", app.company_name, app.title);
  const dossier = await researchCompanyForApplication({
    app,
    companyId: app.company_id,
    force: true,
  });
  console.log("dossier model=", dossier.model, "confidence=", dossier.confidence);
  console.log("fact:", dossier.company_fact.slice(0, 160));
  console.log(
    "targets:",
    (Array.isArray(dossier.contact_targets) ? dossier.contact_targets : [])
      .slice(0, 3)
      .map((t) => t.role)
      .join(" | "),
  );

  const lang = detectLetterLang(app.title, app.description);
  const resume = await resolveResumeForJob(lang);
  const projects = await projectsForCategories(detectCategories(app.title, app.description));
  const crafted = buildPersonalizedOutreach({
    app,
    dossier,
    projects,
    fullName: "Ara Ghahramanyan",
    availability: "January 2027",
    lang,
    kind: "outreach",
  });
  console.log("outreach subject:", crafted.subject);
  console.log(crafted.body);
  console.log("words:", crafted.wordCount);

  const contacts = await listContactsForCompany(app.company_id);
  const contact = contacts.find((c) => c.email);
  if (contact?.email) {
    await pool.query(
      `DELETE FROM outreach_drafts
        WHERE application_id = $1 AND kind = 'outreach' AND lower(to_email) = lower($2)
          AND gmail_draft_id IS NULL`,
      [app.id, contact.email],
    );
    const draft = await createOutreachDraft({
      applicationId: app.id,
      contactId: contact.id,
      resumeId: resume?.id ?? null,
      dossierId: dossier.id,
      kind: "outreach",
      lang: crafted.lang,
      toEmail: contact.email,
      subject: crafted.subject,
      body: crafted.body,
      pushToGmail: false,
    });
    console.log("stored local draft", draft.id, "→", draft.to_email);
  } else {
    console.log("no contact email for outreach storage test");
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
