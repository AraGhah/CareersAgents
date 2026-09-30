// Offline checks for the portal-application system. No database, no network,
// no real employer: fixture forms in scripts/fixtures/portal/ are served from
// 127.0.0.1 and driven in headless Chromium, and a fake answer model stands in
// for Claude.
//   npm run portal:check

import { createServer, type Server } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { projects as seedProjects } from "../seed/project-data";
import { buildCandidateProfile } from "../lib/apply/candidate";
import { classifyField, questionTypeOf } from "../lib/apply/classify";
import { matchOption } from "../lib/apply/options";
import { lintAnswer, lengthTarget, blockingFailures } from "../lib/apply/answers/humanize";
import { buildCorpus, checkGrounding } from "../lib/apply/answers/grounding";
import { buildStyleProfile } from "../lib/apply/answers/style";
import type { AnswerLLM } from "../lib/apply/answers/engine";
import { extractFields, extractFieldsWithOptions } from "../lib/apply/browser/extract";
import { currentValue, fillField, type FillResult } from "../lib/apply/browser/fill";
import { detectCaptcha, detectClosedPosting, detectLoginWall, visibleFormErrors } from "../lib/apply/browser/guards";
import { planFields, mergeApprovals, type PlanContext } from "../lib/apply/planner";
import { adapterFor, canonicalPostingUrl, confirmationText, hasApplicationForm, manualOnlyReason, revealApplicationForm } from "../lib/apply/platforms";
import { preflightPasses, runPreflight } from "../lib/apply/preflight";
import { submitApplication } from "../lib/apply/submit";
import { roleKey } from "../lib/apply/dedupe";
import type { ResumeChoice } from "../lib/apply/resume-select";
import type { FieldDecision, FormField } from "../lib/apply/types";
import type { Answer, Project } from "../lib/types";

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown) {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? "" : `\n       ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const now = new Date();
const answer = (key: string, category: Answer["category"], en: string | null, fr: string | null = en): Answer => ({
  id: key,
  key,
  category,
  answer_en: en,
  answer_fr: fr,
  updated_at: now,
});

// The same facts as seed/answers.ts (which cannot be imported: it writes to the database on import).
const ANSWERS: Answer[] = [
  answer("full_name", "green", "Ara Ghahramanyan"),
  answer("email", "green", "ara.ghahramanyan07@gmail.com"),
  answer("phone", "green", "438-993-6997"),
  answer("city", "green", "Montréal, QC"),
  answer("links", "green", "Portfolio: https://ara-hall-of-projects.vercel.app  GitHub: https://github.com/AraGhah  LinkedIn: https://linkedin.com/in/ara-ghahramanyan"),
  answer("school_program", "green", "Third-year Computer Science Technology (DEC) at Collège de Bois-de-Boulogne, 2024 to now."),
  answer("graduation_date", "green", "June 2027"),
  answer("available_from", "green", "January 2027"),
  answer("location_rule", "green", "Montréal or Laval on-site or hybrid; fully remote elsewhere in Canada"),
  answer("languages", "green", "English and French, written and spoken."),
  answer("why_backend", "yellow", "I mainly work on backend and full-stack systems: REST APIs, authentication, databases, and cloud infrastructure."),
  answer("why_this_company", "yellow", "I will rewrite this for each posting using a fact I wrote down with its source URL. Do not send the generic sentence as-is."),
  answer("strengths", "yellow", "I write systems so a failure is visible. On Dossier I added scoring, retries and dead-letter tracking so weak research stopped hiding behind a green checkmark."),
  answer("work_authorization", "red", null),
];

const PROJECTS: Project[] = seedProjects.map((p, i) => ({ id: String(i), name: p.name, summary: p.summary, tech: p.tech, url: p.url ?? null, highlight_for: p.highlight_for }));

function serve(dir: string): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/thanks") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html><body><h1>Thank you for applying!</h1><p>Your application has been submitted.</p></body></html>");
        return;
      }
      try {
        const body = await readFile(path.join(dir, path.basename(url.pathname)));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, base: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}` });
    });
  });
}

function unitChecks() {
  console.log("\noption matching");
  check(matchOption("Quebec", ["Select...", "Ontario", "QC", "BC"])?.option === "QC", "Quebec → QC (synonym)");
  check(matchOption("Yes", ["Yes, I am authorized", "No, I am not"])?.option === "Yes, I am authorized", "Yes → 'Yes, I am authorized'");
  check(matchOption("No", ["Yes", "No"])?.option === "No", "No → No");
  check(matchOption("Montreal", ["Montreal, Quebec, Canada", "Montreal West, Quebec, Canada"]) === null, "ambiguous Montreal → no match (never the first one)");
  check(matchOption("Montréal, Quebec, Canada", ["Montreal, Quebec, Canada", "Montreal West, Quebec, Canada"])?.option === "Montreal, Quebec, Canada", "full location picks the exact city");
  check(matchOption("Company website", ["LinkedIn", "Company careers page", "Referral"])?.option === "Company careers page", "Company website → careers page (synonym)");
  check(matchOption("DEC", ["High School", "DEC (Diplôme d'études collégiales)", "Bachelor's Degree"])?.option.startsWith("DEC") === true, "DEC → DEC option");
  check(matchOption("Winter 2027", ["Summer 2026", "Fall 2026", "Winter 2027"])?.option === "Winter 2027", "Winter 2027 exact");

  console.log("\nclassification (safety order)");
  const f = (label: string, kind: FormField["kind"] = "text", options: string[] = []): FormField => ({
    index: 0, signature: label, label, kind, required: true, options, name: null, placeholder: null, maxLength: null, rows: null, hint: null, accept: null,
  });
  check(classifyField(f("Are you legally authorized to work in Canada?", "radio", ["Yes", "No"])) === "work_authorization", "work authorization is person-only");
  check(classifyField(f("Will you now or in the future require visa sponsorship?", "select")) === "sponsorship", "sponsorship is person-only");
  check(classifyField(f("I certify that the information provided is true and complete", "checkbox")) === "legal_declaration", "certification is a legal declaration");
  check(classifyField(f("I have read and agree to the Privacy Policy", "checkbox")) === "consent", "privacy consent is person-only");
  check(classifyField(f("What is your date of birth?", "date")) === "sensitive", "date of birth is sensitive");
  check(classifyField(f("Gender", "select")) === "demographic", "gender is demographic");
  check(classifyField(f("Expected salary")) === "salary", "salary is person-only");
  check(classifyField(f("First Name")) === "first_name", "First Name");
  check(classifyField(f("Prénom")) === "first_name", "Prénom (French)");
  check(classifyField(f("Courriel")) === "email", "Courriel (French)");
  check(classifyField(f("Resume/CV", "file")) === "resume", "Resume file");
  check(classifyField(f("Lettre de motivation", "file")) === "cover_letter_file", "cover letter file (French)");
  check(classifyField(f("Tell us about a project from school you are proud of", "textarea")) === "open_question", "long question mentioning 'school' is an open question, not the school field");
  check(classifyField(f("Do you have experience with React?", "radio", ["Yes", "No"])) === "skill_yes_no", "skill yes/no");
  check(questionTypeOf("Why do you want to work at Acme Robotics?") === "why_company", "question type: why company");
  check(questionTypeOf("Why are you a good fit for this role?") === "why_fit", "question type: good fit");
  check(questionTypeOf("Tell us about yourself") === "about_you", "question type: about you");
  check(questionTypeOf("Pourquoi souhaitez-vous rejoindre notre équipe ?") === "why_company", "question type: pourquoi rejoindre (French)");

  console.log("\nhuman-voice lint");
  const target = lengthTarget({ label: "Why us?", hint: null, maxLength: null, rows: 6, kind: "textarea" });
  const robotic =
    "I am writing to express my keen interest in this role. I am passionate about leveraging cutting-edge technologies in a fast-paced environment. Moreover, I would be a valuable asset to your dynamic team!";
  const lint = lintAnswer(robotic, { lang: "en", target });
  check(blockingFailures(lint).some((c) => c.id === "no_stock_phrases"), "stock AI phrasing is blocked", lint.filter((c) => !c.ok));
  check(lint.some((c) => c.id === "no_exclamation" && !c.ok), "exclamation mark flagged");
  check(blockingFailures(lintAnswer("As an AI language model, I think this role fits.", { lang: "en", target })).some((c) => c.id === "no_self_reference"), "self-reference to AI is blocked");
  check(blockingFailures(lintAnswer("I want to join [Company] because of its mission.", { lang: "en", target })).some((c) => c.id === "no_placeholder"), "placeholder is blocked");
  check(lengthTarget({ label: "In 100 words or less, describe yourself", hint: null, maxLength: null, rows: null, kind: "textarea" }).max === 100, "length target read from '100 words'");
  check(lengthTarget({ label: "Why us?", hint: null, maxLength: 300, rows: null, kind: "textarea" }).max <= 43, "length target capped by maxlength");
}

async function main() {
  unitChecks();

  const candidate = buildCandidateProfile({ lang: "en", answers: ANSWERS, projects: PROJECTS, resume: null });
  console.log("\ncandidate profile");
  check(candidate.firstName === "Ara" && candidate.lastName === "Ghahramanyan", "name split");
  check(candidate.city === "Montréal" && candidate.region === "QC" && candidate.country === "Canada", "city/province/country from 'Montréal, QC'");
  check(candidate.education.school === "Collège de Bois-de-Boulogne" && candidate.education.credential === "DEC", "school + credential parsed", candidate.education);
  check(candidate.education.program === "Computer Science Technology", "program parsed", candidate.education.program);
  check(candidate.links.github === "https://github.com/AraGhah", "GitHub link");
  check(candidate.languages.join(",") === "English,French", "languages");

  const job = {
    companyName: "Acme Robotics",
    title: "Software Developer Intern",
    description:
      "Acme Robotics builds warehouse robots used by grocery distributors across Canada. As an intern you will work on our Node.js and PostgreSQL fleet-management backend and React dashboards. Experience with Kafka is a plus. Montréal, hybrid.",
    location: "Montréal, QC",
  };
  const corpus = buildCorpus({ candidate, job, companyNotes: [], samples: [] });

  console.log("\ngrounding");
  const invented = checkGrounding("At Shopify I cut API latency by 40% using Kafka and Rust.", corpus);
  check(invented.checks.find((c) => c.id === "grounded_numbers")?.ok === false, "invented number (40%) is caught", invented.unverified);
  check(invented.checks.find((c) => c.id === "grounded_names")?.ok === false, "invented employer (Shopify) is caught");
  check(invented.checks.find((c) => c.id === "grounded_skills")?.ok === false, "never-used tool (Rust) is caught");
  check(invented.checks.find((c) => c.id === "posting_only_skills")?.ok === false, "posting-only tool (Kafka) is flagged");
  const honest = checkGrounding(
    "Acme Robotics runs its fleet backend on Node.js and PostgreSQL, which is the stack I used for Dossier. A 100-prospect pilot reached about a 9.6% reply rate.",
    corpus,
  );
  check(honest.checks.every((c) => c.ok), "true answer passes grounding", honest.checks.filter((c) => !c.ok));

  console.log("\nstyle profile");
  const style = buildStyleProfile({
    samples: [{ question: "What are your strengths?", question_type: "strengths", answer: "I make failures visible. On Dossier I added retries so a weak step stopped hiding.", lang: "en", source: "edited" }],
    candidate,
    questionType: "strengths",
    question: "What are your greatest strengths?",
    lang: "en",
  });
  check(style.examples[0]?.answer.startsWith("I make failures visible"), "an edited answer of the same type is the first example");
  check(!style.examples.some((e) => /Do not send/.test(e.answer)), "the why_this_company instruction-to-self is never used as a voice sample");

  // Browser part.
  const dir = path.join(process.cwd(), "scripts", "fixtures", "portal");
  const { server, base } = await serve(dir);
  const cache = path.join("cache", "portal-check");
  await mkdir(cache, { recursive: true });
  const resumePath = path.join(cache, "Ara-Ghahramanyan-CV.pdf");
  const letterPath = path.join(cache, "cover-letter.en.pdf");
  await writeFile(resumePath, "%PDF-1.4\n% fixture\n");
  await writeFile(letterPath, "%PDF-1.4\n% fixture\n");

  const goodAnswer =
    "Acme Robotics builds the fleet-management backend on Node.js and PostgreSQL, and that is the part of the posting I read twice. It is the stack I used for Dossier, where I kept workflow state in PostgreSQL with retries and dead-letter handling so a failed step stayed visible instead of disappearing. Robots in grocery warehouses feel like the same problem with higher stakes: when a job fails, someone needs to see exactly where. I would like to learn how your team keeps that state honest at fleet scale.";
  const calls: string[] = [];
  const fakeLLM: AnswerLLM = async (_system, user) => {
    calls.push(user);
    return { answer: goodAnswer, facts_used: ["Dossier uses PostgreSQL with retries"], missing_info: null, confidence: "high" };
  };

  const browser = await chromium.launch({ headless: true });
  const page: Page = await browser.newPage();
  try {
    console.log("\nform extraction (fixture)");
    await page.goto(`${base}/full-form.html`);
    const fields = await extractFieldsWithOptions(page, "#application-form");
    const by = (label: RegExp) => fields.find((x) => label.test(x.label));
    check(!fields.some((x) => x.name === "authenticity_token"), "CSRF token is not a question");
    check(by(/^First Name$/)?.required === true, "First Name, required (from * and required attr)");
    check(by(/^Phone$/)?.required === false, "Phone optional");
    check(by(/Location/)?.kind === "combobox", "Location is a combobox (aria-labelledby resolved)");
    check(by(/Resume/)?.kind === "file" && by(/Resume/)?.required === true, "hidden resume input behind an Attach button is found");
    check(by(/legally authorized/)?.kind === "radio" && by(/legally authorized/)?.options.join() === "Yes,No", "radio group read from fieldset legend");
    check(by(/Languages/)?.kind === "checkbox-group" && by(/Languages/)?.options.length === 3, "checkbox group");
    check(by(/Privacy/)?.kind === "checkbox", "single consent checkbox");
    check(by(/Why do you want/)?.maxLength === 1500, "textarea maxlength read");

    console.log("\nplanning");
    const ctx: PlanContext = {
      candidate,
      job: { ...job, workplaceType: "hybrid", source: "ats", url: `${base}/full-form.html` },
      files: { resumePath, coverLetterPath: letterPath, coverLetterText: null },
      answers: { candidate, companyName: job.companyName, roleTitle: job.title, posting: job.description, companyNotes: [], corpus, samples: [], llm: fakeLLM },
      autoApprove: false,
    };
    const decisions = await planFields(fields, ctx);
    const d = (label: RegExp) => decisions.find((x) => label.test(x.label))!;
    check(d(/^First Name$/).value === "Ara" && d(/^First Name$/).status === "resolved", "first name resolved");
    check(d(/Location/).status === "resolved" && d(/Location/).value === "Montreal, Quebec, Canada", "location resolved onto the combobox's own option", d(/Location/));
    check(d(/^School/).value === "Collège de Bois-de-Boulogne", "school matched onto the select option");
    check(d(/^Degree/).value?.startsWith("DEC") === true, "degree matched to DEC");
    check(d(/graduation/).status === "manual" && d(/graduation/).value === "2027-06-01", "full graduation date is a suggestion to confirm, not a silent fill", d(/graduation/));
    check(d(/legally authorized/).status === "manual" && d(/legally authorized/).value === null, "work authorization left for you, no value");
    check(d(/internship term/).value === "Winter 2027", "term derived from January 2027");
    check(d(/hear about/).value === "Company careers page", "how-heard from the job source");
    check(d(/React/).value === "Yes", "React: yes (in projects)");
    check(d(/Kafka/).status === "manual", "Kafka: not in material → you decide", d(/Kafka/).reason);
    check(d(/Languages/).value === "English|French", "languages checked from the bank");
    check(d(/Why do you want/).status === "generated" && d(/Why do you want/).source === "generated", "why-company drafted, waiting for approval", d(/Why do you want/));
    check(d(/Anything else/).status === "skipped", "optional 'anything else' left blank");
    check(d(/Gender/).status === "skipped", "voluntary gender left blank");
    check(d(/Privacy/).status === "manual", "privacy consent is yours");
    check(calls.length === 1 && calls[0].includes("Acme Robotics") && calls[0].includes("Dossier"), "the model got the posting and the candidate's projects");

    const badLLM: AnswerLLM = async () => ({ answer: "At Shopify I cut latency by 40% with Rust. I am passionate about leveraging synergy!", facts_used: [], missing_info: null, confidence: "high" });
    const [bad] = await planFields([by(/Why do you want/)!], { ...ctx, answers: { ...ctx.answers, llm: badLLM } });
    check(bad.status === "manual" && /Draft failed/.test(bad.reason), "an invented, robotic draft is never approvable as-is", bad.reason);
    const missingLLM: AnswerLLM = async () => ({ answer: "", facts_used: [], missing_info: "No volunteering experience in the material.", confidence: "low" });
    const [missing] = await planFields([{ ...by(/Why do you want/)!, label: "Describe your volunteering experience." }], { ...ctx, answers: { ...ctx.answers, llm: missingLLM } });
    check(missing.status === "manual" && missing.value === null, "missing information → manual, no guess");
    const [noKey] = await planFields([by(/Why do you want/)!], { ...ctx, answers: { ...ctx.answers, llm: null } });
    check(noKey.status === "manual" && noKey.value === null, "without an API key, why-company is left to you (the bank text is an instruction, not an answer)");

    const approvedAgain = mergeApprovals(decisions, [{ signature: d(/legally authorized/).signature, status: "approved", value: "Yes", source: "user" }]);
    check(approvedAgain.find((x) => /legally authorized/.test(x.label))?.value === "Yes", "an earlier approval carries into the new plan");

    console.log("\nfilling + read-back");
    const fills = new Map<string, FillResult>();
    for (const f of fields) {
      const dec = decisions.find((x) => x.signature === f.signature)!;
      if (!["resolved", "approved", "generated"].includes(dec.status) || !dec.value) continue;
      const r = await fillField(page, f, dec);
      fills.set(f.signature, r);
      check(r.ok, `fill ${f.label}`, r.detail);
    }
    check((await page.locator("#loc").inputValue()) === "Montreal, Quebec, Canada", "combobox holds the chosen city");
    check((await page.locator("#resume").evaluate((n) => (n as HTMLInputElement).files?.[0]?.name)) === "Ara-Ghahramanyan-CV.pdf", "CV attached");
    check(await page.locator("input[name=auth]:checked").count() === 0, "work authorization untouched");
    check(!(await page.locator("input[name=privacy]").isChecked()), "privacy consent untouched");

    console.log("\npreflight");
    const requiredEmpty: string[] = [];
    for (const f of fields) if (f.required && !(await currentValue(page, f))) requiredEmpty.push(f.label);
    const resumeChoice: ResumeChoice = {
      resume: { id: "r", language: "en", category: "software-developer", label: "EN software", filename: "cv.pdf", storage_path: resumePath, mime_type: "application/pdf", byte_size: 1, is_active: true, uploaded_at: now, analyzed_at: now, raw_text: null, profile_json: null, analysis_error: null },
      reason: "Développeur logiciel CV in the posting's language (EN)",
      categories: ["software-developer"],
      langMatches: true,
      fileExists: true,
    };
    const pre = runPreflight({
      decisions, fills, requiredEmpty, resume: resumeChoice, resumeFieldPresent: true, coverLetter: null, coverLetterUsed: false,
      captcha: await detectCaptcha(page), formErrors: await visibleFormErrors(page), duplicate: null, isTarget: false,
      autoApprove: false, submitRequested: true, submitEnabled: false,
    });
    const item = (id: string) => pre.find((i) => i.id === id);
    check(!preflightPasses(pre), "full form does not pass: it has questions only you can answer");
    check(item("required_filled")?.ok === false && /legally authorized/.test(item("required_filled")?.detail ?? ""), "required work-authorization reported empty");
    check(item("nothing_pending")?.ok === false, "unapproved draft + consent reported as pending");
    check(item("submit_enabled")?.ok === false, "submit is off by default");
    check(item("read_back")?.ok === true, "every filled value read back", item("read_back"));

    const noCv = runPreflight({
      decisions: decisions.filter((x) => x.intent !== "resume"), fills: new Map(), requiredEmpty: [], resume: resumeChoice,
      resumeFieldPresent: false, coverLetter: null, coverLetterUsed: false, captcha: { present: false, challenge: false, kind: null },
      formErrors: [], duplicate: null, isTarget: false, autoApprove: true, submitRequested: true, submitEnabled: true,
    });
    check(noCv.find((i) => i.id === "cv_on_form")?.ok === false && !preflightPasses(noCv), "a form without a CV upload (step 1 of a multi-step portal) never passes");

    const outcome = await submitApplication(page, adapterFor(`${base}/full-form.html`), pre);
    check(outcome.state === "blocked", "submitApplication refuses a failing preflight");
    check(!/thanks/.test(page.url()), "…and nothing was sent");

    console.log("\nsubmit path (simple fixture, PORTAL_ALLOW_SUBMIT=true in-process)");
    await page.goto(`${base}/simple-form.html`);
    const sFields = await extractFields(page, "#application-form");
    const sDecisions: FieldDecision[] = await planFields(sFields, ctx);
    const sFills = new Map<string, FillResult>();
    for (const f of sFields) {
      const dec = sDecisions.find((x) => x.signature === f.signature)!;
      if (dec.value && ["resolved", "approved"].includes(dec.status)) sFills.set(f.signature, await fillField(page, f, dec));
    }
    const sEmpty: string[] = [];
    for (const f of sFields) if (f.required && !(await currentValue(page, f))) sEmpty.push(f.label);
    process.env.PORTAL_ALLOW_SUBMIT = "true";
    const sPre = runPreflight({
      decisions: sDecisions, fills: sFills, requiredEmpty: sEmpty, resume: resumeChoice, resumeFieldPresent: true, coverLetter: null, coverLetterUsed: false,
      captcha: await detectCaptcha(page), formErrors: await visibleFormErrors(page), duplicate: null, isTarget: false,
      autoApprove: false, submitRequested: true, submitEnabled: true,
    });
    check(preflightPasses(sPre), "simple form passes every gate", sPre.filter((i) => !i.ok));
    const dupPre = sPre.map((i) => (i.id === "not_duplicate" ? { ...i, ok: false } : i));
    check((await submitApplication(page, adapterFor(`${base}/simple-form.html`), dupPre)).state === "blocked", "a duplicate is refused even with submit enabled");
    const sOutcome = await submitApplication(page, adapterFor(`${base}/simple-form.html`), sPre);
    check(sOutcome.state === "submitted", "submits and reads the confirmation", sOutcome);
    check(!!(await confirmationText(page, adapterFor(page.url()))), "confirmation page recognized");
    delete process.env.PORTAL_ALLOW_SUBMIT;

    console.log("\nreal-world page shapes (found on live portals)");
    const ctxPage = await browser.newContext();
    const jobPage = await ctxPage.newPage();
    await jobPage.goto(`${base}/job-page.html`);
    check(!(await hasApplicationForm(jobPage)), "a job page with site search and a newsletter box is not an application form");
    const formPage = await revealApplicationForm(jobPage, adapterFor(`${base}/job-page.html`));
    check(formPage.url().endsWith("/bilingual-form.html"), "Apply behind a cookie banner and a chat widget, opening a new tab, is followed", formPage.url());
    check((await jobPage.evaluate(() => (window as unknown as { __consent?: string }).__consent)) === "reject", "the cookie banner is answered with the least consent (Reject all)");
    check(await hasApplicationForm(formPage), "the form page is recognized as an application form");

    const bFields = await extractFieldsWithOptions(formPage, "#resumator-form");
    const bf = (re: RegExp, n = 0) => bFields.filter((x) => re.test(x.label) || re.test(x.placeholder ?? ""))[n];
    check(classifyField(bf(/crédits académiques/)) === "unknown", "yes/no question mentioning 'établissement' is not the School field");
    check(classifyField(bf(/inscrit/)) === "unknown", "yes/no question mentioning 'programme' is not the Program field");
    check(classifyField(bf(/C\+\+/)) === "years_experience", "an experience-level dropdown is a judgment call, not a written answer");
    check(classifyField(bf(/^City$/)) === "city" && classifyField(bf(/Province/)) === "region" && classifyField(bf(/Postal/)) === "postal_code", "Address group split by placeholder: city / province / postal code");
    const bDecisions = await planFields(bFields, ctx);
    const bd = (re: RegExp) => bDecisions.find((x) => re.test(x.label) || re.test(bFields.find((f) => f.signature === x.signature)?.placeholder ?? ""))!;
    check(bd(/^City$/).value === "Montréal" && bd(/Province/).value === "Quebec", "city and province filled from 'Montréal, QC'", [bd(/^City$/).value, bd(/Province/).value]);
    check(bd(/crédits académiques/).status === "manual" && /yes\/no/.test(bd(/crédits académiques/).reason), "the yes/no question goes to you with a yes/no reason", bd(/crédits académiques/).reason);
    check(bd(/C\+\+/).status === "manual" && /C\+\+/.test(bd(/C\+\+/).reason), "C++ level goes to you, saying C++ is not in your material", bd(/C\+\+/).reason);
    await ctxPage.close();

    await page.goto(`${base}/jobs/acme/closed`);
    check(!!(await detectClosedPosting(page)), "a redirect to a /closed page is a closed posting");
    await page.setContent("<main><h1>Job not found</h1><p>The job you requested was not found.</p></main>");
    check(!!(await detectClosedPosting(page)), "'Job not found' is a closed posting");

    console.log("\nguards (CAPTCHA, login wall)");
    // Nothing leaves the machine: every non-local request is answered with an empty page.
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" }));
    await page.setContent(
      `<form><input name="a"/><iframe src="https://newassets.hcaptcha.com/captcha/v1/static/hcaptcha.html" width="300" height="80"></iframe></form>`,
    );
    const hc = await detectCaptcha(page);
    check(hc.challenge && hc.kind === "hCaptcha", "a visible hCaptcha is a stop", hc);
    await page.setContent(
      `<form><input name="a"/><iframe src="https://www.google.com/recaptcha/api2/anchor?k=x&size=invisible" width="256" height="60"></iframe></form>`,
    );
    const inv = await detectCaptcha(page);
    check(inv.present && !inv.challenge, "an invisible reCAPTCHA badge is noted, not a stop", inv);
    await page.setContent(`<form><input name="email"/><input type="password" name="pw"/><button>Sign in</button></form>`);
    check(!!(await detectLoginWall(page)), "a sign-in page is a login wall");
    await page.setContent(`<form><input aria-invalid="true" aria-describedby="e1" name="email"/><span id="e1">Email is required</span></form>`);
    check((await visibleFormErrors(page)).includes("Email is required"), "the form's own validation message is read");
  } finally {
    await browser.close();
    server.close();
  }

  console.log("\nplatforms + dedupe");
  check(adapterFor("https://jobs.lever.co/acme/123").formUrl("https://jobs.lever.co/acme/123", { boardToken: null, externalId: null }).endsWith("/123/apply"), "Lever → /apply");
  check(adapterFor("https://jobs.ashbyhq.com/acme/abc").id === "ashby", "Ashby detected");
  check(
    adapterFor("https://acme.com/careers?gh_jid=42").formUrl("https://acme.com/careers?gh_jid=42", { boardToken: "acme", externalId: "42" }).includes("job-boards.greenhouse.io/embed/job_app?for=acme&token=42"),
    "Greenhouse embed on a company site → the board's own form",
  );
  check(canonicalPostingUrl("https://jobs.lever.co/acme/123/apply?utm_source=x") === canonicalPostingUrl("https://jobs.lever.co/acme/123"), "canonical URL ignores /apply and tracking params");
  check(roleKey("Software Developer Intern (Winter 2027)") === roleKey("Stage - Software Developer"), "same role across postings has one key");
  check(!!manualOnlyReason("https://www.linkedin.com/jobs/view/1"), "LinkedIn is never driven");
  check(!!manualOnlyReason("https://acme.wd3.myworkdayjobs.com/x"), "Workday is never driven");

  console.log(failures === 0 ? "\nall portal checks passed" : `\n${failures} portal check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
