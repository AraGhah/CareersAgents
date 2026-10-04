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
import type Anthropic from "@anthropic-ai/sdk";
import { answerQuestion, answerTier, type AnswerLLM } from "../lib/apply/answers/engine";
import { createMessage, modelLabel, pickModel, tokenLimit, usageSummary } from "../lib/claude";
import { extractFields, extractFieldsWithOptions } from "../lib/apply/browser/extract";
import { currentValue, fillField, type FillResult } from "../lib/apply/browser/fill";
import { detectCaptcha, detectClosedPosting, detectLoginWall, visibleFormErrors } from "../lib/apply/browser/guards";
import { planFields, mergeApprovals, type PlanContext } from "../lib/apply/planner";
import {
  adapterFor,
  advanceStep,
  canonicalPostingUrl,
  confirmationText,
  findNextStep,
  hasApplicationForm,
  isNextStepButton,
  manualOnlyReason,
  revealApplicationForm,
  scopeSelector,
} from "../lib/apply/platforms";
import { resolveField } from "../lib/apply/resolve";
import { preflightPasses, runPreflight } from "../lib/apply/preflight";
import { submitApplication } from "../lib/apply/submit";
import { roleKey, twinKey, twinKeys } from "../lib/apply/dedupe";
import { collapseCopies } from "../lib/queries";
import type { ResumeChoice } from "../lib/apply/resume-select";
import type { FieldDecision, FormField } from "../lib/apply/types";
import type { Answer, JobRow, Project } from "../lib/types";

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
  check(classifyField(f("Work authorization status", "select")) === "work_authorization", "'work authorization' as a noun is person-only too");
  check(classifyField(f("I certify that the information provided is true and complete", "checkbox")) === "legal_declaration", "certification is a legal declaration");
  check(classifyField(f("I have read and agree to the Privacy Policy", "checkbox")) === "consent", "privacy consent is person-only");
  check(classifyField(f("What is your date of birth?", "date")) === "sensitive", "date of birth is sensitive");
  check(classifyField(f("Gender", "select")) === "demographic", "gender is demographic");
  check(classifyField(f("Expected salary")) === "salary", "salary is person-only");
  check(classifyField(f("When are you available for internship?")) === "available_from", "'when are you available' is the start date");
  check(classifyField(f("How many months are you available for an internship for? Please indicate start month and end month", "textarea")) === "open_question", "'how many months are you available' is not the start date");
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

/** Which Claude answers which question: the tier a question starts on, and when the strong model is called in. */
async function routingChecks(env: { candidate: ReturnType<typeof buildCandidateProfile>; corpus: ReturnType<typeof buildCorpus>; job: { companyName: string; title: string; description: string }; goodAnswer: string }) {
  console.log("\nmodel routing (which Claude answers which question)");
  const HAIKU = "claude-haiku-4-5-20251001";
  const SONNET = "claude-sonnet-5-5";

  check(answerTier("why_company", 150) === "hard" && answerTier("why_fit", 150) === "hard" && answerTier("why_role", 150) === "hard", "company-specific questions start on the strong model");
  check(answerTier("about_you", 150) === "hard" && answerTier("challenge", 150) === "hard" && answerTier("technical", 150) === "hard", "questions that synthesize start on the strong model");
  check(["strengths", "weakness", "teamwork", "career_goal", "project"].every((t) => answerTier(t as never, 150) === "easy"), "strengths, weakness, teamwork, career goal and project start on the cheap one");
  check(answerTier("generic", 60) === "easy" && answerTier("generic", 150) === "easy", "a short generic question is cheap");
  check(answerTier("generic", 250) === "hard" && answerTier("strengths", 250) === "hard", "a long answer (over 200 words) is the strong model's");

  const saved = { ...process.env };
  for (const k of ["ANTHROPIC_MODEL_HARD", "ANTHROPIC_MODEL_EASY", "ANTHROPIC_EFFORT", "ANTHROPIC_EFFORT_EASY", "ANTHROPIC_ANSWER_MODEL"]) delete process.env[k];
  const hard = pickModel("hard");
  const easy = pickModel("easy");
  check(hard.model === SONNET && hard.effort === "high", "hard = Sonnet 5.5 at high effort", hard);
  check(easy.model === HAIKU && easy.effort === null, "easy = Haiku 4.5, no effort setting", easy);
  process.env.ANTHROPIC_MODEL_EASY = "claude-sonnet-5-5";
  process.env.ANTHROPIC_EFFORT = "max";
  check(pickModel("easy").model === SONNET && pickModel("hard").effort === "max", "both tiers can be pointed elsewhere from .env.local");
  check(pickModel("easy", "claude-opus-5-5").model === "claude-opus-5-5" && pickModel("hard", "claude-opus-5-5").model === "claude-opus-5-5", "a pinned model wins over the tiers");
  process.env.ANTHROPIC_EFFORT = "nonsense";
  check(pickModel("hard").effort === "high", "an unknown effort falls back to high");
  Object.assign(process.env, saved);
  for (const k of ["ANTHROPIC_MODEL_HARD", "ANTHROPIC_MODEL_EASY", "ANTHROPIC_EFFORT", "ANTHROPIC_EFFORT_EASY", "ANTHROPIC_ANSWER_MODEL"]) if (!(k in saved)) delete process.env[k];
  check(modelLabel(HAIKU) === "Haiku 4.5" && modelLabel(SONNET) === "Sonnet 5.5" && modelLabel("claude-sonnet-5") === "Sonnet 5", "model names read as people say them");
  check(tokenLimit(2000, "hard") > 2000 && tokenLimit(2000, "easy") === 2000, "the strong model gets room to think; the cheap one does not need it");

  // The call: Haiku 4.5 rejects an effort setting with a 400, so it is never sent one; a model that turns out to
  // reject it is retried without, and remembered.
  const sent: Array<{ model: string; effort?: string }> = [];
  const stub = {
    messages: {
      create: async (p: { model: string; output_config?: { effort?: string } }) => {
        sent.push({ model: p.model, effort: p.output_config?.effort });
        if (p.model === "claude-future-1" && p.output_config?.effort) throw Object.assign(new Error("This model does not support the effort parameter."), { status: 400 });
        return { usage: { input_tokens: 10, output_tokens: 5 }, content: [], stop_reason: "end_turn" };
      },
    },
  } as unknown as Anthropic;
  const params = { max_tokens: 10, messages: [{ role: "user" as const, content: "x" }] };
  await createMessage(stub, { tier: "easy", model: HAIKU, effort: "high" }, params);
  check(sent[0].effort === undefined, "Haiku is never sent an effort setting");
  await createMessage(stub, { tier: "hard", model: SONNET, effort: "high" }, params);
  check(sent[1].effort === "high", "Sonnet is sent one");
  await createMessage(stub, { tier: "hard", model: "claude-future-1", effort: "high" }, params);
  check(sent[2].effort === "high" && sent[3].effort === undefined, "a model that rejects it is retried without");
  await createMessage(stub, { tier: "hard", model: "claude-future-1", effort: "high" }, params);
  check(sent[4].effort === undefined && sent.length === 5, "and is not asked again");
  check(/Haiku 4\.5 ×1/.test(usageSummary() ?? "") && /Sonnet 5\.5 ×1/.test(usageSummary() ?? ""), "the tokens each model used are tallied", usageSummary());

  // The engine: which tier each attempt runs on.
  const field = (label: string): FormField => ({ index: 0, signature: label, label, kind: "textarea", required: true, options: [], name: null, placeholder: null, maxLength: null, rows: 6, hint: null, accept: null });
  const draft = (over: Partial<{ answer: string; missing_info: string | null; confidence: "high" | "medium" | "low" }> = {}, model = HAIKU) => ({
    answer: env.goodAnswer, facts_used: ["Dossier uses PostgreSQL"], missing_info: null, confidence: "high" as const, model, ...over,
  });
  const robotic = "I am writing to express my keen interest. I am passionate about leveraging synergy in a fast-paced environment!";
  const run = async (label: string, script: Array<(tier: string | undefined) => ReturnType<typeof draft>>) => {
    const tiers: Array<string | undefined> = [];
    let i = 0;
    const llm: AnswerLLM = async (_s, _u, o) => {
      tiers.push(o?.tier);
      return script[Math.min(i++, script.length - 1)](o?.tier);
    };
    const out = await answerQuestion(field(label), { candidate: env.candidate, companyName: env.job.companyName, roleTitle: env.job.title, posting: env.job.description, companyNotes: [], corpus: env.corpus, samples: [], llm });
    return { tiers: tiers.join(">"), out };
  };
  const cheapGood = () => draft();
  const strongGood = () => draft({}, SONNET);

  const a = await run("What are your greatest strengths?", [cheapGood]);
  check(a.tiers === "easy" && a.out.status === "generated" && /Haiku 4\.5/.test(a.out.reason), "a strengths question is drafted once, by the cheap model", a);
  const b = await run("Why do you want to work at Acme Robotics?", [strongGood]);
  check(b.tiers === "hard" && b.out.status === "generated" && /Sonnet 5\.5/.test(b.out.reason), "a why-us question goes straight to the strong model", b);
  const c = await run("What are your greatest strengths?", [() => draft({ answer: robotic }), strongGood]);
  check(c.tiers === "easy>hard" && c.out.status === "generated", "a cheap draft that fails the checks is redone by the strong model", c);
  const d = await run("What are your greatest strengths?", [() => draft({ answer: "", missing_info: "no strengths listed" }), strongGood]);
  check(d.tiers === "easy>hard" && d.out.status === "generated", "'material lacks this' from the cheap model gets a second look from the strong one", d);
  const e = await run("What are your greatest strengths?", [() => draft({ answer: "", missing_info: "nothing" }), () => draft({ answer: "", missing_info: "nothing in the material" }, SONNET)]);
  check(e.tiers === "easy>hard" && e.out.status === "manual" && e.out.value === null, "and if the strong model agrees, it is yours (no guess)", e);
  const f = await run("What are your greatest strengths?", [() => draft({ confidence: "low" }), strongGood]);
  check(f.tiers === "easy>hard" && f.out.status === "generated", "a low-confidence cheap draft is checked by the strong model", f);
  const g = await run("Why do you want to work at Acme Robotics?", [() => draft({ answer: robotic }, SONNET), strongGood]);
  check(g.tiers === "hard>hard" && g.out.status === "generated", "a strong model's own failed draft is revised by the strong model, not escalated", g);
  const h = await run("Describe your volunteering experience in 250 words.", [strongGood]);
  // (The fake answer is far shorter than 250 words, so the length check sends it to a revision: still the strong model.)
  check(h.tiers.startsWith("hard") && !h.tiers.includes("easy"), "a 250-word answer starts on the strong model and stays there", h);
}

/** Personal and legal answers are suggested from the answer bank, never filled: the plan stays "manual" until confirmed. */
function personalChecks() {
  console.log("\npersonal answers (suggested, never filled)");
  const mk = (label: string, kind: FormField["kind"] = "text", options: string[] = [], required = true): FormField => ({
    index: 0, signature: label, label, kind, required, options, name: null, placeholder: null, maxLength: null, rows: null, hint: null, accept: null,
  });
  const personal = [
    answer("work_authorization", "red", "Canadian citizen", "Citoyen canadien"),
    answer("sponsorship_required", "red", "No", "Non"),
    answer("salary_expectation", "red", "Negotiable", "Négociable"),
    answer("previous_employment", "red", "No", "Non"),
    answer("gender", "red", "Man", "Homme"),
    answer("ethnicity", "red", "White", "Blanc"),
    answer("disability", "red", "No", "Non"),
    answer("indigenous", "red", "No", "Non"),
    answer("visible_minority", "red", "No", "Non"),
    answer("veteran", "red", "No", "Non"),
    answer("hispanic_latino", "red", "No", "Non"),
    answer("lgbtq", "red", "No", "Non"),
  ];
  const withPersonal = (lang: "en" | "fr") =>
    buildCandidateProfile({ lang, answers: [...ANSWERS.filter((a) => a.key !== "work_authorization"), ...personal], projects: PROJECTS, resume: null });
  const bare = buildCandidateProfile({ lang: "en", answers: ANSWERS, projects: PROJECTS, resume: null });
  const job = { companyName: "Acme", title: "Software Developer Intern", description: null, location: "Montréal, QC", workplaceType: null, source: "linkedin", url: "https://x" };
  const files = { resumePath: null, coverLetterPath: null, coverLetterText: null };
  const ask = (field: FormField, cand = withPersonal("en"), where = job) => resolveField(field, classifyField(field), cand, where, files);
  const YN = ["Yes", "No"];

  const auth = ask(mk("Are you legally authorized to work in Canada?", "radio", YN));
  check(auth.status === "manual" && auth.value === "Yes", "authorized to work in Canada → suggests Yes, still yours to confirm", auth);
  check(ask(mk("Are you legally authorized to work in the United States?", "radio", YN)).value === null, "the same question about the United States is not answered from a Canadian citizenship");
  check(ask(mk("Are you a citizen of another country?", "radio", YN)).value === null, "'citizen of another country' is not answered");
  check(ask(mk("Do you require a work permit to work in Canada?", "radio", YN)).value === null, "'do you require a work permit' is a different question");
  check(ask(mk("Work authorization status", "select", ["Canadian citizen", "Permanent resident", "Work permit", "Study permit"])).value === "Canadian citizen", "a status list gets the status itself");
  check(ask(mk("Are you authorized to work for any employer?", "radio", YN), withPersonal("en"), { ...job, location: "Remote" }).value === null, "no country named and a job outside Canada: nothing suggested");
  check(ask(mk("Will you now or in the future require sponsorship to work in Canada?", "radio", YN)).value === "No", "no sponsorship needed → suggests No");
  check(ask(mk("Will you now or in the future require visa sponsorship to work in the United States?", "radio", YN)).value === null, "sponsorship for the United States is not answered");
  check(ask(mk("Do you hold a valid visa?", "radio", YN)).value === null, "a visa question that is not about sponsorship is not answered");

  const disability = ask(mk("Do you have a disability?", "radio", ["Yes, I have a disability, or have had one in the past", "No, I do not have a disability and have not had one in the past", "I do not want to answer"]));
  check(disability.value?.startsWith("No, I do not have a disability") === true && disability.status === "manual", "disability: 'No, I do not...' is picked, not 'I do not want to answer'", disability);
  check(ask(mk("Veteran Status", "select", ["I identify as one or more of the classifications of protected veteran", "I am not a protected veteran", "I don't wish to answer"])).value === "I am not a protected veteran", "veteran: 'I am not a protected veteran'");
  check(ask(mk("Gender", "select", ["Male", "Female", "Non-binary", "Decline to self-identify"])).value === "Male", "gender: Man → Male");
  check(ask(mk("Genre", "select", ["Homme", "Femme", "Non binaire"]), withPersonal("fr")).value === "Homme", "genre (French)");
  check(ask(mk("Race / Ethnicity", "select", ["Hispanic or Latino", "White (Not Hispanic or Latino)", "Black or African American", "Asian", "Two or More Races", "Decline to self-identify"])).value === "White (Not Hispanic or Latino)", "ethnicity: White");
  check(ask(mk("Are you Hispanic/Latino?", "radio", ["Yes", "No", "Prefer not to answer"])).value === "No", "Hispanic/Latino → No, never 'Prefer not to answer'");
  check(ask(mk("Do you identify as Indigenous?", "radio", YN)).value === "No", "Indigenous → No");
  check(ask(mk("Are you a member of a visible minority group?", "radio", YN)).value === "No", "visible minority → No");
  check(ask(mk("Do you identify as LGBTQ2S+?", "radio", YN)).value === "No", "LGBTQ2S+ → No");
  check(ask(mk("Sexual orientation", "select", ["Heterosexual", "Gay or lesbian", "Bisexual", "Prefer not to say"])).value === null, "a list of orientations is not guessed from a 'No'");
  check(ask(mk("Gender identity and sexual orientation")).value === null, "two topics in one question: nothing suggested");
  check(ask(mk("I am not a protected veteran", "checkbox")).value === null, "a single tick-box is never suggested");

  const salary = ask(mk("Salary expectations"));
  check(salary.value === "Negotiable" && salary.status === "manual", "salary on a text field → Negotiable");
  check(ask(mk("Expected salary", "number")).value === null, "salary on a number field is not guessed");
  check(ask(mk("Have you previously worked at Acme?", "radio", YN)).value === "No", "previous employment → No");
  check(ask(mk("Are you bound by a non-compete agreement?", "radio", YN)).value === null, "non-compete is a different question");
  check(ask(mk("Êtes-vous autorisé à travailler au Canada?", "radio", ["Oui", "Non"]), withPersonal("fr")).value === "Oui", "authorized to work (French) → Oui");

  console.log("\nwhen nothing is stored");
  check(ask(mk("Gender", "select", ["Male", "Female"]), bare).value === null && ask(mk("Gender", "select", ["Male", "Female"]), bare).status === "manual", "required and not stored → yours, no suggestion");
  check(ask(mk("Gender", "select", ["Male", "Female"], false), bare).status === "skipped", "optional and not stored → left blank, as before");
  const everyManual = [
    mk("Are you legally authorized to work in Canada?", "radio", YN),
    mk("Do you have a disability?", "radio", YN),
    mk("Gender", "select", ["Male", "Female"]),
    mk("Salary expectations"),
    mk("Have you previously worked at Acme?", "radio", YN),
  ].every((x) => ask(x).status === "manual");
  check(everyManual, "a suggestion is never a resolved value: every one stays 'manual' until you confirm");
  check(matchOption("No", ["Yes, I have a disability", "No, I do not have a disability", "I do not want to answer"])?.option === "No, I do not have a disability", "'I do not want to answer' is not a No");

  // The two screening topics are the exception: Ara told the desk there is nothing there, so a plain yes/no is filled.
  console.log("\nscreening questions (criminal record, security issues): answered from what you told the desk");
  const screening = [
    answer("criminal_record_check", "red", "No criminal record.", "Aucun casier judiciaire."),
    answer("security_clearance", "red", "No security issues.", "Aucun problème de sécurité."),
  ];
  const screened = (lang: "en" | "fr", extra: Answer[] = screening) =>
    buildCandidateProfile({ lang, answers: [...ANSWERS, ...extra], projects: PROJECTS, resume: null });
  const say = (label: string, options: string[] = YN, lang: "en" | "fr" = "en", kind: FormField["kind"] = "radio") =>
    ask(mk(label, kind, options), screened(lang));

  const crim = say("Do you have a criminal record?");
  check(crim.status === "resolved" && crim.value === "No" && crim.source === "bank", "criminal record → No, filled (no click needed)", crim);
  check(say("Have you ever been convicted of a criminal offence for which you have not received a pardon?").value === "No", "convicted of a criminal offence → No");
  check(say("Avez-vous un casier judiciaire?", ["Oui", "Non"], "fr").value === "Non", "casier judiciaire (French) → Non");
  check(say("Are you able to obtain a security clearance?").value === "Yes", "able to obtain a security clearance → Yes");
  check(say("Are you able to pass a criminal background check?").value === "Yes", "able to pass a criminal background check → Yes");
  check(say("Is there any reason that would prevent you from obtaining a security clearance?").value === "No", "a reason that would prevent a clearance → No");
  check(say("Do you have any security concerns or issues?").value === "No", "security concerns → No");
  check(say("Do you have a criminal record?", ["Yes", "No", "Prefer not to answer"]).value === "No", "never 'Prefer not to answer'");

  console.log("\n…and only those questions");
  const stays = (label: string, options: string[] = YN, kind: FormField["kind"] = "radio") => {
    const r = say(label, options, "en", kind);
    return r.status === "manual" && r.value === null;
  };
  check(stays("Are you willing to undergo a criminal background check?"), "'willing to undergo a check' is a consent: yours");
  check(stays("Do you hold a valid security clearance?"), "'do you hold a clearance' is not 'no problems': yours");
  check(stays("Do you have a clean criminal record?"), "'clean record' turns the question around: yours");
  check(stays("Are you currently facing any criminal charges?"), "pending charges are not a 'record': yours");
  check(stays("Have you ever been convicted of a traffic offence?"), "a traffic offence is not a criminal record: yours");
  check(stays("Are you unable to obtain a security clearance?"), "'unable to' is not answered");
  check(stays("Are you not able to obtain a security clearance?"), "a negated ability question is not answered");
  check(stays("Please provide a certificate of your criminal record"), "asking for a document is not a yes/no: yours");
  check(stays("Do you have a criminal record? If yes, please explain", [], "textarea"), "an explain box is not a yes/no: yours");
  check(stays("I have no criminal record", [], "checkbox"), "a single tick-box is never suggested");
  check(stays("Date of birth", [], "text"), "other sensitive data is untouched");

  const unstored = ask(mk("Do you have a criminal record?", "radio", YN), bare);
  check(unstored.status === "manual" && unstored.value === null, "nothing stored → yours, as before");
  const changed = ask(mk("Do you have a criminal record?", "radio", YN), screened("en", [answer("criminal_record_check", "red", "Yes, one minor offence in 2019.")]));
  check(changed.status === "manual" && changed.value === null, "if the stored statement is ever anything but 'No ...', it goes back to being yours");
  const asGreen = ask(mk("Do you have a criminal record?", "radio", YN), screened("en", [answer("criminal_record_check", "green", "No criminal record.")]));
  check(asGreen.status === "manual", "only a red bank entry counts");
  check(classifyField(mk("Do you have any security concerns or issues?", "radio", YN)) === "sensitive", "a security question is classified as sensitive, so it is never guessed by another rule");

  console.log("\nPORTAL_AUTO_CONFIRM_PERSONAL=true: the bank answers without a click, as strictly as before");
  const auto = (field: FormField, cand = withPersonal("en"), where = job) => resolveField(field, classifyField(field), cand, where, files, { autoConfirm: true });
  const authAuto = auto(mk("Are you legally authorized to work in Canada?", "radio", YN));
  check(authAuto.status === "resolved" && authAuto.value === "Yes" && authAuto.source === "bank", "authorized to work in Canada → Yes, filled", authAuto);
  check(auto(mk("Will you now or in the future require sponsorship to work in Canada?", "radio", YN)).status === "resolved", "sponsorship → No, filled");
  check(auto(mk("Are you legally authorized to work in the United States?", "radio", YN)).status === "manual", "a question the bank does not answer (United States) still goes to you");
  check(auto(mk("Gender", "select", ["Male", "Female", "Decline to self-identify"])).value === "Male", "required self-identification → your stored answer");
  check(auto(mk("Gender", "select", ["Male", "Female", "Decline to self-identify"], false)).status === "skipped", "optional self-identification → left blank, even with the stored answer");
  check(auto(mk("Gender", "select", ["Male", "Female"]), bare).status === "manual", "nothing stored → still yours");
  const privacy = auto(mk("I have read the privacy notice and consent to the processing of my personal data for this application", "checkbox"));
  check(privacy.status === "resolved" && privacy.value === "Yes", "required consent to process this application → ticked", privacy);
  check(auto(mk("I certify that the information provided is true and complete", "checkbox")).value === "Yes", "required 'the information is accurate' → ticked");
  check(auto(mk("I agree to receive marketing emails and job alerts", "checkbox")).status === "manual", "marketing / job alerts are never ticked");
  check(auto(mk("I consent to a criminal background check", "checkbox")).status === "manual", "a background-check consent stays yours");
  check(auto(mk("I agree to join the talent community for future opportunities", "checkbox")).status === "manual", "a talent pool stays yours");
  check(auto(mk("I agree to the privacy policy", "checkbox", [], false)).status === "manual", "an optional consent box is left alone");
  check(resolveField(mk("I have read the privacy notice", "checkbox"), "consent", withPersonal("en"), job, files).status === "manual", "without the setting, consent stays yours (unchanged)");
}

async function main() {
  unitChecks();
  personalChecks();

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
  await routingChecks({ candidate, corpus, job, goodAnswer });

  const calls: string[] = [];
  const fakeLLM: AnswerLLM = async (_system, user) => {
    calls.push(user);
    return { answer: goodAnswer, facts_used: ["Dossier uses PostgreSQL with retries"], missing_info: null, confidence: "high" };
  };

  const browser = await chromium.launch({ headless: true });
  const page: Page = await browser.newPage();
  try {
    console.log("\nAshby-shaped page: no <form>, a small panel shares the form's class");
    await page.goto(`${base}/ashby-like.html`);
    const ashbyScope = await scopeSelector(page, adapterFor("https://jobs.ashbyhq.com/acme/1/application"));
    const ashbyFields = await extractFieldsWithOptions(page, ashbyScope);
    check(ashbyScope === null, "a class that matches only a piece of the page is not the form: the whole page is read", ashbyScope);
    check(ashbyFields.length >= 7, "every question is read, not just the autofill panel's one input", ashbyFields.map((x) => x.label));
    check(ashbyFields.some((x) => x.label === "Name" && x.required) && ashbyFields.some((x) => /location/i.test(x.label) && x.required), "required fields are still recognized");

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

    console.log("\nmulti-step form: page 1 → Next → page 2 → Submit (PORTAL_AUTO_CONFIRM_PERSONAL=true)");
    const wizCandidate = buildCandidateProfile({
      lang: "en",
      answers: [...ANSWERS.filter((a) => a.key !== "work_authorization"), answer("work_authorization", "red", "Canadian citizen", "Citoyen canadien")],
      projects: PROJECTS,
      resume: { ...resumeChoice.resume!, raw_text: "Ara Ghahramanyan\nMontreal, QC H4N 0C5 | ara.ghahramanyan07@gmail.com\nFrench (fluent) | English (fluent) | Armenian (perfect)" },
    });
    const wizCtx: PlanContext = { ...ctx, candidate: wizCandidate, answers: { ...ctx.answers, candidate: wizCandidate }, autoApprove: true, autoConfirm: true, step: 1 };
    const wizAdapter = adapterFor(`${base}/wizard-form.html`);
    const okPre = [{ id: "all_ok", ok: true, label: "every gate", blocking: true }];
    await page.goto(`${base}/wizard-form.html`);
    const w1 = await extractFieldsWithOptions(page, "#application-form");
    check(w1.length === 4 && !w1.some((x) => x.kind === "file"), "page 1 is read on its own: the hidden page 2 is not part of it", w1.map((x) => x.label));
    const early = await findNextStep(page);
    check(!!early && !early.disabled, "the Next button of page 1 is found");
    const refused = await advanceStep(page, early!.button);
    check(!refused.moved && /required field/.test(refused.reason ?? ""), "Next on an empty page: the form stays, and says why", refused);
    process.env.PORTAL_ALLOW_SUBMIT = "true";
    const notFinal = await submitApplication(page, wizAdapter, okPre);
    check(notFinal.state === "blocked" && (await page.locator("#page1").isVisible()), "a type=submit Next button is never pressed as the final Submit", notFinal);
    const w1d = await planFields(w1, wizCtx);
    check(w1d.find((x) => /Postal/.test(x.label))?.value === "H4N 0C5", "postal code read from the CV", w1d.find((x) => /Postal/.test(x.label)));
    for (const f of w1) {
      const dec = w1d.find((x) => x.signature === f.signature)!;
      if (dec.value && ["resolved", "approved"].includes(dec.status)) check((await fillField(page, f, dec)).ok, `page 1: fill ${f.label}`);
    }
    const next1 = await findNextStep(page);
    const moved = await advanceStep(page, next1!.button);
    check(moved.moved && (await page.locator("#page2").isVisible()), "Next moves to page 2", moved);
    const w2 = await extractFieldsWithOptions(page, "#application-form");
    check((await page.locator("#page1 [data-desk-field]").count()) === 0, "page 1's old field stamps are cleared, so they cannot collide with page 2's");
    check(w2.some((x) => x.kind === "file") && !w2.some((x) => /First name/.test(x.label)), "page 2 is read: CV upload, no page-1 field", w2.map((x) => x.label));
    const w2d = await planFields(w2, { ...wizCtx, step: 2 });
    const w = (re: RegExp) => w2d.find((x) => re.test(x.label))!;
    check(w(/authorized/).status === "resolved" && w(/authorized/).value === "Yes", "work authorization answered from the bank", w(/authorized/));
    check(w(/French/).value === "Fluent", "French level: 'Fluent' from the CV, never 'Native'", w(/French/));
    check(w(/privacy/).status === "resolved", "required privacy consent for this application → ticked", w(/privacy/));
    check(w(/job alerts/).status !== "resolved", "the job-alerts box is left alone", w(/job alerts/));
    check(w2d.every((x) => x.step === 2), "fields planned on page 2 carry their page number");
    for (const f of w2) {
      const dec = w2d.find((x) => x.signature === f.signature)!;
      if (dec.value && ["resolved", "approved"].includes(dec.status)) check((await fillField(page, f, dec)).ok, `page 2: fill ${f.label}`);
    }
    check(!(await findNextStep(page)), "page 2 has no Next (Back is not one): it is the last page");
    check(!(await isNextStepButton(page.locator("#send"))), "'Submit application' is not a Next button");
    const wizOutcome = await submitApplication(page, wizAdapter, okPre);
    check(wizOutcome.state === "submitted", "the final Submit is pressed on the last page and the confirmation read", wizOutcome);
    const sent = await page.evaluate(() => (window as unknown as { __submitted?: Record<string, unknown> }).__submitted);
    check(sent?.cv === "Ara-Ghahramanyan-CV.pdf" && sent?.auth === "yes" && sent?.privacy === true && sent?.alerts === false, "what the employer received: CV, Yes, privacy ticked, job alerts not", sent);
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
  check(
    twinKey("c1", "Intern, Software Developer/ Stagiaire en Développement Logiciel") ===
      twinKey("c1", "intern software developer, stagiaire en développement logiciel"),
    "the same posting listed twice (punctuation and word order aside) is one tracked role",
  );
  check(twinKey("c1", "Software Developer Intern") !== twinKey("c2", "Software Developer Intern"), "the same title at another company is another role");
  check(twinKey("c1", "Intern, AI Developer") !== twinKey("c1", "Intern, Software Developer"), "different roles at one company stay apart");
  check(twinKey("c1", "Intern") === null, "a title with nothing left after the noise is never compared");
  check(roleKey("C-GE-112 Stagiaire développeur(se) logiciel – Environnement immersif-EN") === roleKey("C-GE-112 Stagiaire développeur(se) logiciel – Environnement immersif"), "a copy tagged -EN is the same role");
  const coded = [
    { company_id: "c1", title: "Stagiaire en Développement Cloud, Intern Cloud Developer – FCAP" },
    { company_id: "c1", title: "Stagiaire en Développement Cloud, Intern Cloud Developer" },
    { company_id: "c1", title: "Backend Developer – SAP" },
    { company_id: "c1", title: "Backend Developer – AWS" },
  ];
  const ck = twinKeys(coded);
  check(ck.get(coded[0]) === ck.get(coded[1]), "a copy that only adds a trailing code (– FCAP) joins the plain posting");
  check(ck.get(coded[2]) !== ck.get(coded[3]), "two coded titles with no plain one stay two roles (– SAP, – AWS)");

  const jr = (id: string, title: string, source: string, score: string, status: JobRow["status"] = null, company_id = "c1"): JobRow => ({
    id, title, source, score, status, company_id, company_name: "Acme", location: null, workplace_type: null, url: `https://x/${id}`,
    posted_at: null, first_seen_at: new Date(), closed_at: null, application_id: status ? `app-${id}` : null, gated: false, has_email: false,
  });
  const listed = [
    jr("1", "Software Developer Intern (Winter 2027)", "linkedin", "0.9"),
    jr("2", "Data Analyst Intern", "indeed", "0.85"),
    jr("3", "Stage - Software Developer", "indeed", "0.8", "qualified"),
    jr("4", "Software Developer Intern", "greenhouse", "0.7"),
    jr("5", "Cloud Intern", "linkedin", "0.6"),
  ];
  const collapsed = collapseCopies(listed, [{ company_id: "c1", title: "Cloud Intern - FR" }]);
  check(collapsed.length === 2, "three postings of one role become one row; a role already applied to is hidden with its copies", collapsed.map((r) => r.id));
  check(collapsed.find((r) => r.copies === 3)?.id === "3", "the row kept is the copy you already track", collapsed);
  check(JSON.stringify(collapsed.find((r) => r.id === "3")?.copy_sources) === JSON.stringify({ linkedin: 1, greenhouse: 1 }), "it says where the other copies were found", collapsed);
  const untracked = collapseCopies(listed.filter((r) => !r.status));
  check(untracked.find((r) => /Software/.test(r.title))?.id === "4", "with nothing tracked, the company's own posting is kept over LinkedIn and Indeed");
  check(!!manualOnlyReason("https://www.linkedin.com/jobs/view/1"), "LinkedIn is never driven");
  check(!!manualOnlyReason("https://acme.wd3.myworkdayjobs.com/x"), "Workday is never driven");

  console.log(failures === 0 ? "\nall portal checks passed" : `\n${failures} portal check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
