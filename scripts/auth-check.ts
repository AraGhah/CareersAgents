// Offline checks of the account / authentication subsystem's parts and of the answers a Canadian citizen gives: no browser,
// no network, no real employer, fake credentials. With --db it also writes one run's state trail to the database and
// deletes it again.
//   npm run auth:check            (npm run auth:check -- --db)
//
// The browser side (sign-in, sign-up, verification, CAPTCHA, guest, vault on fixture portals) is npm run account:check.

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyAccountPage, accountFieldIntent, interventionReason, type AccountFieldInfo } from "../lib/apply/account";
import { pickVerificationCode, type MailMessage } from "../lib/apply/account-mail";
import { authAdapterFor, knownIds } from "../lib/apply/auth/adapters";
import { credentialProvider } from "../lib/apply/auth/credentials";
import { generatePassword, mergePolicies, parsePasswordPolicy, policyViolations } from "../lib/apply/auth/password-policy";
import { fileVault, openVault } from "../lib/apply/auth/vault";
import { isNoticeOptionSet, noticeRange, scheduleFit } from "../lib/apply/availability";
import { authorizationFrom, buildCandidateProfile, parseDay } from "../lib/apply/candidate";
import { classifyField } from "../lib/apply/classify";
import { factsFor } from "../lib/apply/agent/facts";
import { canMove, FlowTracker, terminalFlowState } from "../lib/apply/flow-state";
import { resolveField, type JobContext } from "../lib/apply/resolve";
import type { FieldKind, FormField } from "../lib/apply/types";
import type { Answer } from "../lib/types";

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown) {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail === undefined ? "" : `\n       ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const CREDS = { email: "test@example.com", password: "Test-Pass-123!" };

function passwordPolicy() {
  console.log("password rules, read from what the portal prints");
  // As abb.wd3.myworkdayjobs.com printed them on 2026-10-06.
  const abb = parsePasswordPolicy(
    "Create Account\nPassword Requirements:\n\nA minimum of 8 characters\nAn alphabetic character\nAn uppercase character\nA numeric character\nA lowercase character\nA special character\nEmail Address*\nPassword*",
  );
  check(abb.minLength === 8 && abb.upper && abb.lower && abb.digit && abb.special, "Workday's list: 8 minimum, upper, lower, digit, special", abb);
  check(policyViolations(abb, CREDS.password).length === 0, "the configured password meets it");
  check(policyViolations(abb, "short").join(", ") === "shorter than 8 characters, no uppercase letter, no digit, no special character", "a weak password: each broken rule named", policyViolations(abb, "short"));
  const fr = parsePasswordPolicy("Le mot de passe doit contenir au moins 12 caractères, une majuscule, une minuscule et un chiffre.");
  check(fr.minLength === 12 && fr.upper && fr.lower && fr.digit && !fr.special, "in French: 12, majuscule, minuscule, chiffre", fr);
  const between = parsePasswordPolicy("Password must be between 10 and 16 characters and cannot contain: < > & spaces");
  check(between.minLength === 10 && between.maxLength === 16 && between.forbidden.includes("<") && between.forbidden.includes(" "), "a length range and forbidden characters", between);
  for (const p of [abb, fr, between, parsePasswordPolicy("Password must be at least 30 characters.")]) {
    const pw = generatePassword(p);
    check(policyViolations(p, pw).length === 0 && pw !== generatePassword(p), `a generated password meets "${p.rules[0]?.slice(0, 50)}" and differs every time`);
  }
  check(generatePassword(between).length <= 16 && ![..."<>& "].some((c) => generatePassword(between).includes(c)), "…within the maximum, without the refused characters");
  check(parsePasswordPolicy("First name Last name Email").rules.length === 0, "a page with no rules gives no rules (the configured password is used)");
  check(mergePolicies(abb, parsePasswordPolicy("Password must be at least 14 characters")).minLength === 14, "a refusal's rule tightens what the page printed");
}

function vaultAndCredentials() {
  console.log("\nthe vault (per-portal passwords) and which password a portal gets");
  const file = path.join(os.tmpdir(), `desk-vault-unit-${process.pid}.json`);
  rmSync(file, { force: true });
  try {
    check(openVault({}) === null && openVault({ PORTAL_VAULT_KEY: "short" }) === null, "no PORTAL_VAULT_KEY (or a too-short one): no vault, nothing generated");
    const vault = fileVault(file, "unit-test-key-0123456789");
    vault.put("acme.wd3.myworkdayjobs.com", CREDS.email, "Gen-Pass-Only-Here-9!");
    const raw = readFileSync(file, "utf8");
    check(!raw.includes("Gen-Pass-Only-Here-9!") && raw.includes("aes") === false, "the file holds the password encrypted, never in clear");
    check(vault.get("acme.wd3.myworkdayjobs.com", CREDS.email)?.password === "Gen-Pass-Only-Here-9!", "…and gives it back with the right key");
    let wrongKey = "";
    try {
      fileVault(file, "another-key-0123456789").get("acme.wd3.myworkdayjobs.com", CREDS.email);
    } catch (err) {
      wrongKey = (err as Error).message;
    }
    check(wrongKey.length > 0, "another key cannot open it (it fails, it never returns a wrong password)");
    // An entry copied onto another host does not open: the host is part of what is authenticated.
    const data = JSON.parse(raw);
    data.entries["evil.example.com"] = data.entries["acme.wd3.myworkdayjobs.com"];
    writeFileSync(file, JSON.stringify(data));
    let moved = "";
    try {
      vault.get("evil.example.com", CREDS.email);
    } catch (err) {
      moved = (err as Error).message;
    }
    check(moved.length > 0, "an entry moved to another host does not decrypt");
    vault.remove("evil.example.com");

    const provider = credentialProvider(CREDS, vault);
    const signIn = provider.forSignIn("acme.wd3.myworkdayjobs.com");
    check(signIn.length === 2 && signIn[0].source === "vault" && signIn[1].source === "default", "an unconfirmed vault password is tried first, then the configured one (two tries at most)");
    vault.confirm("acme.wd3.myworkdayjobs.com");
    check(provider.forSignIn("acme.wd3.myworkdayjobs.com").length === 1, "once confirmed, only the vault password");
    check(provider.forSignIn("other.example.com")[0].source === "default", "any other portal: the configured account");
    const easy = provider.forSignUp("new.example.com", parsePasswordPolicy("A minimum of 8 characters"), false);
    check("creds" in easy && easy.source === "default", "rules the configured password meets: it is used, nothing generated");
    const hard = provider.forSignUp("new.example.com", parsePasswordPolicy("Password must be at least 24 characters"), false);
    check("creds" in hard && hard.source === "generated" && vault.get("new.example.com", CREDS.email)?.password === hard.creds.password, "rules it breaks: a compliant one is made AND kept before the portal is asked");
    const noVault = credentialProvider(CREDS, null).forSignUp("new.example.com", parsePasswordPolicy("Password must be at least 24 characters"), false);
    check("problem" in noVault && /PORTAL_VAULT_KEY/.test(noVault.problem), "without a vault: a reason naming the fix, never a password kept anywhere", noVault);
    check(provider.secrets("new.example.com").length === 2, "both passwords are known to the redaction");
  } finally {
    rmSync(file, { force: true });
  }
}

function codesAndPages() {
  console.log("\nmailed codes, and which page is which");
  const now = Date.now();
  const mail = (over: Partial<MailMessage>): MailMessage => ({ from: "Workday <no-reply@myworkday.com>", subject: "Your verification code", receivedMs: now, text: "", html: "", ...over });
  const pick = (m: MailMessage[], host = "acme.wd3.myworkdayjobs.com") => pickVerificationCode(m, host, now - 5000);
  check(pick([mail({ text: "Your verification code is 482913. It expires in 10 minutes." })]) === "482913", "'Your verification code is 482913'");
  check(pick([mail({ html: "<p>Use this code to verify your account:</p><p><b>AB12CD</b></p>" })]) === "AB12CD", "a letters-and-digits code in an HTML message");
  check(pick([mail({ from: "Careers <careers@acme.com>", subject: "Code de vérification", text: "Votre code de vérification : 7731" })], "careers.acme.com") === "7731", "in French, from the employer's own domain");
  check(pick([mail({ from: "promo@shop.example", text: "Your code is 123456" })]) === null, "a code from any other sender is never used");
  check(pick([mail({ receivedMs: now - 3_600_000, text: "Your code is 999999" })]) === null, "a message older than the account is ignored");
  check(pick([mail({ subject: "Application received", text: "Thank you. Job ID 2024111, posted 2026." })]) === null, "a message that does not announce a code gives none");

  const facts = (over: Partial<Parameters<typeof classifyAccountPage>[0]>) => ({ pw: 0, confirm: false, buttons: [] as string[], text: "", ...over });
  check(classifyAccountPage(facts({ codeInput: true, inputs: 1, text: "we've sent a verification code to your email" })) === "verify_code", "a code box after 'we've sent a code': verify_code");
  check(classifyAccountPage(facts({ codeInput: true, inputs: 1, text: "two-step verification: enter the code we sent by sms to your phone" })) === "intervention", "a code by SMS: intervention");
  check(classifyAccountPage(facts({ inputs: 1, text: "please answer your security question: name of your first pet" })) === "intervention", "a security question: intervention");
  check(classifyAccountPage(facts({ inputs: 0, text: "to continue, verify your identity with a government-issued photo id" })) === "intervention", "an ID check: intervention");
  check(classifyAccountPage(facts({ inputs: 14, codeInput: true, text: "postal code phone verification code sent sms" })) === "none", "a full application form is never read as a challenge");
  check(interventionReason("enter your email") === null, "an ordinary page is not an intervention");
  check(authAdapterFor("abb.wd3.myworkdayjobs.com").id === "workday" && authAdapterFor("careers.acme.com").id === "generic", "Workday portals get the Workday adapter, others the generic one");
  check(knownIds(authAdapterFor("careers.acme.com"), "create").includes("createAccountSubmitButton"), "a Workday form embedded elsewhere is still recognised by its ids");
}

function fieldNormalization() {
  console.log("\naccount-form fields, through the shared classifier");
  const f = (label: string, over: Partial<AccountFieldInfo> = {}) => accountFieldIntent({ label, name: null, placeholder: null, autocomplete: null, tag: "INPUT", type: "text", options: [], ...over });
  for (const label of ["First Name", "Given name", "Legal First Name", "Prénom"]) check(f(label) === "first_name", `"${label}" → first name`, f(label));
  check(f("Your first name", { name: "fname" }) === "first_name", '"Your first name" (name=fname) → first name', f("Your first name", { name: "fname" }));
  for (const label of ["Last Name", "Family Name", "Surname", "Nom de famille"]) check(f(label) === "last_name", `"${label}" → last name`, f(label));
  check(f("", { autocomplete: "given-name" }) === "first_name" && f("", { autocomplete: "section-x tel" }) === "phone", "autocomplete tokens are read first");
  check(f("Province", { tag: "SELECT", options: ["Québec", "Ontario"] }) === "region" && f("Country") === "country" && f("City") === "city", "province, country, city");
  check(f("Username") === "email" && f("Confirm Email Address") === "email", "username and a confirm-email box take the account's email");
  check(f("Date of birth") === null && f("Social Insurance Number") === null && f("Security question") === null, "anything else (birth date, SIN, security question) is not filled: the form stops for you");
}

function flowStates() {
  console.log("\nthe explicit application state");
  check(canMove(null, "FOUND_JOB") && canMove("PLATFORM_DETECTED", "AUTH_REQUIRED") && canMove("AUTH_REQUIRED", "REGISTERING_ACCOUNT"), "found → … → auth required → registering");
  check(canMove("EMAIL_VERIFICATION_REQUIRED", "SIGNING_IN") && canMove("AUTHENTICATED", "APPLICATION_FORM"), "verification → sign-in, authenticated → application form");
  check(!canMove("SUBMITTED", "ANSWERING_QUESTIONS") && !canMove("FOUND_JOB", "SUBMITTED"), "no way back from submitted, no skipping to it");
  check(canMove("ANSWERING_QUESTIONS", "MANUAL_INTERVENTION_REQUIRED") && canMove("MANUAL_INTERVENTION_REQUIRED", "SUBMITTED"), "any step may stop for a person, who may then submit");
  check(terminalFlowState("blocked") === "MANUAL_INTERVENTION_REQUIRED" && terminalFlowState("ready_to_submit") === "READY_FOR_SUBMISSION" && terminalFlowState("failed") === "FAILED", "finished runs map onto the flow");
}

async function flowTracker() {
  const seen: string[] = [];
  const t = new FlowTracker((e) => void seen.push(`${e.state}${e.unexpected ? "!" : ""}`));
  await t.to("FOUND_JOB");
  await t.to("OPENED_APPLICATION");
  await t.to("PLATFORM_DETECTED", "Workday");
  await t.to("PLATFORM_DETECTED");
  await t.to("SIGNING_IN");
  await t.to("SUBMITTED");
  await t.to("FAILED", "boom");
  await t.to("ANSWERING_QUESTIONS");
  check(seen.join(" ") === "FOUND_JOB OPENED_APPLICATION PLATFORM_DETECTED SIGNING_IN! SUBMITTED!", "the tracker: a repeat is a no-op, a surprising jump is kept but flagged, nothing follows the end", seen);
}

// ---------------------------------------------------------------------------------------------------------------------
// Cases G to J: what a Canadian citizen answers
// ---------------------------------------------------------------------------------------------------------------------

const answer = (key: string, category: Answer["category"], en: string | null, auto_use = false, fr: string | null = null): Answer => ({ id: key, key, category, answer_en: en, answer_fr: fr, updated_at: new Date(), auto_use });
const ANSWERS: Answer[] = [
  answer("full_name", "green", "Ara Ghahramanyan"),
  answer("city", "green", "Montréal, QC"),
  answer("available_from", "green", "January 1, 2027"),
  answer("work_while_studying", "green", "Yes, part time while I finish my studies, when the schedule allows."),
  answer("work_authorization", "red", "Canadian citizen", true),
  answer("sponsorship_required", "red", "No", true),
];
const candidate = buildCandidateProfile({ lang: "en", answers: ANSWERS, projects: [], resume: null });
const FULL_TIME_JOB: JobContext = { companyName: "Acme", title: "Software Developer Intern - Winter 2027", description: "A full-time internship (40 hours per week) starting January 2027.", location: "Montréal, QC", workplaceType: "hybrid", source: null, url: "https://example.com" };
const PART_TIME_JOB: JobContext = { ...FULL_TIME_JOB, title: "Part-time Developer (students)", description: "Part-time, 15 hours per week during the school year, flexible schedule." };
const UNKNOWN_JOB: JobContext = { ...FULL_TIME_JOB, description: "Join our team as an intern." };
const NOW = new Date("2026-10-06T12:00:00Z");
const files = { resumePath: null, coverLetterPath: null, coverLetterText: null };

function field(label: string, kind: FieldKind, options: string[] = [], over: Partial<FormField> = {}): FormField {
  return { index: 0, signature: label, label, kind, required: true, options, name: null, placeholder: null, maxLength: null, rows: null, hint: null, accept: null, ...over };
}
function decide(f: FormField, job: JobContext = FULL_TIME_JOB) {
  return resolveField(f, classifyField(f), candidate, job, files, { autoConfirm: false, now: NOW });
}
const YES_NO = ["Select...", "Yes", "No"];

function caseG() {
  console.log("\nCASE G: Canadian work authorization (from your confirmed answers, no click, no model)");
  check(candidate.authorization.status === "citizen" && candidate.authorization.canada.requiresWorkPermit === false && candidate.authorization.canada.expires === null, "the structured record: citizen, no permit, nothing expires", candidate.authorization);
  const expect = (label: string, kind: FieldKind, options: string[], want: string, job?: JobContext) => {
    const d = decide(field(label, kind, options), job);
    check(d.status === "resolved" && d.value === want, `"${label}" → ${want}`, d);
  };
  expect("Are you legally authorized to work in Canada?", "radio", YES_NO, "Yes");
  expect("Are you currently authorized to work in Canada?", "select", YES_NO, "Yes");
  expect("Do you have unrestricted authorization to work in Canada?", "radio", YES_NO, "Yes");
  expect("Will you now or in the future require sponsorship to work in Canada?", "radio", YES_NO, "No");
  expect("Do you require visa sponsorship?", "select", YES_NO, "No");
  expect("Do you require a work permit?", "radio", YES_NO, "No");
  expect("Do you require a visa to work in Canada?", "radio", YES_NO, "No");
  expect("What type of work authorization do you have?", "select", ["Select...", "Canadian Citizen", "Permanent Resident", "Work Permit", "Other"], "Canadian Citizen");
  expect("What type of work authorization do you have?", "select", ["Select...", "Citizen", "Permanent Resident", "Open Work Permit", "Study Permit"], "Citizen");
  expect("What is your citizenship?", "text", [], "Canadian");
  expect("Country of citizenship", "select", ["Select...", "Brazil", "Canada", "France"], "Canada");
  const other = decide(field("Are you a citizen of another country?", "radio", YES_NO));
  check(other.status === "manual", "'a citizen of another country?' is not answered from a Canadian citizenship", other);
  const us = decide(field("Are you legally authorized to work in the United States?", "radio", YES_NO));
  check(us.status === "manual", "the United States: never answered from a Canadian status", us);
  const usJob = decide(field("Do you require a work permit?", "radio", YES_NO), { ...FULL_TIME_JOB, location: "Seattle, WA, United States" });
  check(usJob.status === "manual", "a permit question for a job outside Canada (no country named): yours", usJob);
  const unconfirmed = buildCandidateProfile({ lang: "en", answers: ANSWERS.map((a) => ({ ...a, auto_use: false })), projects: [], resume: null });
  const d = resolveField(field("Do you require a work permit?", "radio", YES_NO), "sponsorship", unconfirmed, FULL_TIME_JOB, files, { now: NOW });
  check(d.status === "manual" && d.value === "No", "not confirmed on /answers (and auto-confirm off): offered as a suggestion, not filled", d);
}

function caseH() {
  console.log("\nCASE H: a visa / permit expiry date is never made up");
  const label = "If you are currently authorized to work on a visa or work permit, when does your authorization expire?";
  check(classifyField(field(label, "date")) === "authorization_expiry", "recognised as an expiry question (not as sponsorship)");
  const na = decide(field(label, "select", ["Select...", "Not Applicable", "Within 6 months", "6-12 months", "More than 12 months"]));
  check(na.status === "resolved" && na.value === "Not Applicable", "a 'Not Applicable' option is chosen", na);
  const naShort = decide(field("Work permit expiry date", "radio", ["N/A", "2026", "2027", "2028+"]));
  check(naShort.value === "N/A", "…or 'N/A'", naShort);
  const text = decide(field(label, "text"));
  check(text.status === "resolved" && text.value === "Not applicable (Canadian citizen)", "a text box: 'Not applicable (Canadian citizen)'", text);
  const required = decide(field(label, "date"));
  check(required.status === "manual" && required.value === null && /never makes up a date/.test(required.reason), "a required date box: no value, flagged for you", required);
  const optional = decide(field(label, "date", [], { required: false }));
  check(optional.status === "skipped" && optional.value === null, "an optional date box: left empty", optional);
  const noNa = decide(field("Visa expiration date", "select", ["Select...", "2026", "2027", "2028"]));
  check(noNa.status === "manual" && noNa.value === null, "only dates on offer: none picked, flagged", noNa);
  const facts = factsFor(candidate, { companyName: "Acme", title: "Intern", location: "Montréal, QC", description: null }, new Map(), { autoConfirm: false });
  check(/expiry date: NOT APPLICABLE[\s\S]*NEVER type a date/.test(facts) && /requires a work permit: No/.test(facts), "the AI form agent is told the same (Workday wizards)");
  check(authorizationFrom("Permanent resident of Canada", "No").canada.requiresWorkPermit === false && authorizationFrom("Permanent resident of Canada", "No").citizenship === null, "(a permanent resident would get no citizenship answer)");
  check(authorizationFrom(null, null).canada.authorized === null, "no stored status: nothing derived");
}

function caseI() {
  console.log("\nCASE I: full-time start: January 1, 2027");
  check(parseDay("January 1, 2027") === 1 && parseDay("1er janvier 2027") === 1 && parseDay("January 2027") === null, "the day is read when written");
  check(candidate.availability.fullTimeStart === "2027-01-01", "full-time start: 2027-01-01");
  const date = decide(field("Available start date", "date"));
  check(date.status === "resolved" && date.value === "2027-01-01", "a date box: 2027-01-01, no confirmation needed now that the day is written", date);
  const mmdd = decide(field("Start date", "text", [], { placeholder: "MM/DD/YYYY" }));
  check(mmdd.value === "01/01/2027" && mmdd.status === "resolved", "MM/DD/YYYY → 01/01/2027", mmdd);
  const notice = ["Select...", "Available Immediately", "2-4 weeks", "4-8 weeks", "8+ weeks"];
  check(isNoticeOptionSet(notice) && JSON.stringify(noticeRange("8+ weeks")) === JSON.stringify([8, Infinity]) && JSON.stringify(noticeRange("Available Immediately")) === "[0,0]", "notice periods are read as ranges");
  const sel = decide(field("What is your availability / notice period?", "select", notice));
  check(sel.status === "resolved" && sel.value === "8+ weeks", "a full-time role, on 2026-10-06: '8+ weeks' (12 weeks to January 1)", sel);
  const unknown = decide(field("When are you available to start?", "select", notice), UNKNOWN_JOB);
  check(unknown.value === "8+ weeks", "a schedule the posting does not state: the full-time date, never 'immediately'", unknown);
  const yes = decide(field("Are you available to start in January 2027?", "radio", YES_NO));
  check(yes.status === "resolved" && yes.value === "Yes", "'available to start in January 2027?' → Yes", yes);
  const early = decide(field("Are you available to start on November 2, 2026?", "radio", YES_NO));
  check(early.status === "manual", "'available to start November 2, 2026?' (full time): not claimed, yours", early);
  const term = decide(field("Which internship term are you applying for?", "select", ["Select...", "Fall 2026", "Winter 2027", "Summer 2027"]));
  check(term.value === "Winter 2027", "the term still reads Winter 2027", term);
  const free = decide(field("When can you start?", "text"));
  check(free.value === "January 1, 2027", "a free-text 'when can you start' (full time): January 1, 2027", free);
}

function caseJ() {
  console.log("\nCASE J: earlier, part time alongside school, only when the posting allows it");
  check(scheduleFit(PART_TIME_JOB.description, PART_TIME_JOB.title) === "fits_studies" && scheduleFit(FULL_TIME_JOB.description) === "full_time" && scheduleFit(UNKNOWN_JOB.description) === "unknown", "the posting's schedule is read");
  const notice = ["Select...", "Available Immediately", "2-4 weeks", "4-8 weeks", "8+ weeks"];
  const sel = decide(field("What is your availability / notice period?", "select", notice), PART_TIME_JOB);
  check(sel.status === "resolved" && sel.value === "Available Immediately", "a part-time role during the school year: 'Available Immediately'", sel);
  const free = decide(field("When can you start?", "text"), PART_TIME_JOB);
  check(/^Immediately, part time alongside my studies; full time from January 1, 2027\.$/.test(free.value ?? ""), "free text says both, truthfully", free);
  const noStudy = buildCandidateProfile({ lang: "en", answers: ANSWERS.filter((a) => a.key !== "work_while_studying"), projects: [], resume: null });
  const d = resolveField(field("What is your availability / notice period?", "select", notice), "available_from", noStudy, PART_TIME_JOB, files, { now: NOW });
  check(d.value === "8+ weeks", "without your 'work while studying' answer: never 'immediately'", d);
}

async function dbTrail() {
  if (!process.argv.includes("--db")) return;
  console.log("\nthe state trail in the database (--db)");
  const { pool } = await import("../lib/db");
  const { createRun, finishRun, recordFlow, getRun } = await import("../lib/apply/store");
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM applications ORDER BY id LIMIT 1`);
  if (!rows[0]) {
    console.log("  (no application in the database: skipped)");
    return;
  }
  const runId = await createRun({ applicationId: rows[0].id, mode: "plan", postingUrl: "https://example.com/check", companyName: "auth-check", roleTitle: "auth-check" });
  try {
    const t = new FlowTracker((e) => recordFlow(runId, e));
    await t.to("FOUND_JOB");
    await t.to("OPENED_APPLICATION", null, "https://example.com/check");
    await t.to("PLATFORM_DETECTED", "Workday");
    await t.to("AUTH_REQUIRED");
    await t.to("REGISTERING_ACCOUNT");
    await finishRun(runId, "blocked", { blocked_reason: "reCAPTCHA on the account page" });
    const { rows: r } = await pool.query<{ flow_state: string; flow_log: Array<{ state: string; detail: string | null }> }>(`SELECT flow_state, flow_log FROM portal_runs WHERE id = $1`, [runId]);
    const states = r[0].flow_log.map((e) => e.state);
    check(r[0].flow_state === "MANUAL_INTERVENTION_REQUIRED" && states.join(" ") === "FOUND_JOB OPENED_APPLICATION PLATFORM_DETECTED AUTH_REQUIRED REGISTERING_ACCOUNT MANUAL_INTERVENTION_REQUIRED", "each state written as entered; the stop ends the trail with its reason", r[0]);
    check(r[0].flow_log.at(-1)?.detail === "reCAPTCHA on the account page", "…and why");
    check(!!(await getRun(runId)), "the run row itself is unchanged in shape");
  } finally {
    await pool.query(`DELETE FROM portal_runs WHERE id = $1`, [runId]);
    await pool.end();
  }
}

async function main() {
  passwordPolicy();
  vaultAndCredentials();
  codesAndPages();
  fieldNormalization();
  flowStates();
  await flowTracker();
  caseG();
  caseH();
  caseI();
  caseJ();
  await dbTrail();
  if (failures) {
    console.log(`\n${failures} auth check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nauth-check passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
