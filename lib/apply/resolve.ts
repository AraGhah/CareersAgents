// Deterministic answers: intent + candidate profile → the value for one field.
// Written answers (open questions) are the answer engine's job; this module only
// marks them. Three outcomes:
//   resolved  — a value that is literally in the candidate's data
//   manual    — a person decides; `value` may hold a suggestion to confirm
//               (e.g. a full date when only "January 2027" is written down)
//   skipped   — optional, and nothing true to put there

import { candidateHasSkill, type CandidateProfile } from "./candidate";
import { PERSON_ONLY_INTENTS } from "./classify";
import { isYesNoOptionSet, matchOption, realOptions } from "./options";
import { personalSuggestion } from "./personal";
import { cleanLabel, norm } from "./text";
import { extractSkillsFromText } from "../profile";
import type { FieldDecision, FieldIntent, FieldSource, FieldStatus, FormField, Lang } from "./types";

export type JobContext = {
  companyName: string;
  title: string;
  description: string | null;
  location: string | null;
  workplaceType: string | null;
  source: string | null;
  url: string;
};

export type FileContext = {
  resumePath: string | null;
  coverLetterPath: string | null;
  coverLetterText: string | null;
};

type Outcome = Pick<FieldDecision, "source" | "value" | "status" | "reason">;

export type ResolveOptions = {
  /**
   * PORTAL_AUTO_CONFIRM_PERSONAL=true: what your answer bank says about a personal question (work authorization,
   * sponsorship, self-identification, salary, previous employment) is filled without a click, and a required box that
   * only consents to the application itself (privacy notice, "the information is accurate") is ticked. The matching
   * stays as strict as for a suggestion: a question the bank does not clearly answer still goes to you.
   */
  autoConfirm?: boolean;
};

const CHOICE_KINDS = new Set<FormField["kind"]>(["select", "radio", "checkbox-group", "combobox"]);

const PERSON_ONLY_REASON: Outcome["reason"] = "Legal, eligibility or personal question: you answer it yourself.";

const REASON_BY_INTENT: Record<string, string> = {
  work_authorization: "Work authorization: a legal statement, you answer it yourself.",
  sponsorship: "Visa sponsorship: a legal statement, you answer it yourself.",
  legal_declaration: "A legal declaration: read it and tick it yourself.",
  consent: "Consent / privacy terms: read them and decide yourself.",
  sensitive: "Sensitive personal information: never filled automatically.",
  demographic: "Voluntary self-identification: your choice, never filled automatically.",
  salary: "Pay expectations: you answer it yourself.",
  previous_employment: "Previous employment with this company: not in your data.",
  referral: "Referral / relationships: not in your data.",
};

function resolved(value: string, source: FieldSource, reason: string): Outcome {
  return { value, source, status: "resolved", reason };
}

function manual(reason: string, suggestion: string | null = null): Outcome {
  return { value: suggestion, source: suggestion ? "derived" : "none", status: "manual", reason };
}

function unavailable(field: FormField, what: string): Outcome {
  return field.required
    ? manual(`${what} is not in your answer bank or CV.`)
    : { value: null, source: "none", status: "skipped", reason: `Optional, and ${what.toLowerCase()} is not in your data.` };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A month + year written down, shaped for this field. Day-precision formats need a day nobody wrote: suggest. */
function dateFor(field: FormField, year: number | null, month: number | null, text: string | null, what: string): Outcome {
  if (!year) return text ? resolved(text, "bank", `${what} from your answer bank.`) : unavailable(field, what);
  const fmt = `${field.placeholder ?? ""} ${field.hint ?? ""}`.toUpperCase();
  if (field.kind === "month" && month) return resolved(`${year}-${pad(month)}`, "derived", `${what}: ${text}.`);
  if (field.kind === "date" || /DD/.test(fmt)) {
    if (!month) return manual(`${what} needs a full date; only "${text}" is written down.`);
    const iso = `${year}-${pad(month)}-01`;
    const shaped = field.kind === "date" ? iso : /DD\/MM/.test(fmt) ? `01/${pad(month)}/${year}` : `${pad(month)}/01/${year}`;
    return manual(`${what}: the form wants a day, your data says "${text}". Confirm the 1st or change it.`, shaped);
  }
  if (/MM\s*\/\s*YYYY/.test(fmt) && month) return resolved(`${pad(month)}/${year}`, "derived", `${what}: ${text}.`);
  if (/YYYY-MM/.test(fmt) && month) return resolved(`${year}-${pad(month)}`, "derived", `${what}: ${text}.`);
  if (field.kind === "number" || /^YYYY$/.test(fmt.trim())) return resolved(String(year), "derived", `${what}: ${text}.`);
  return resolved(text ?? String(year), "bank", `${what} from your answer bank.`);
}

function termName(month: number | null, year: number | null, lang: Lang): string | null {
  if (!month || !year) return null;
  const season = month <= 4 ? ["Winter", "Hiver"] : month <= 8 ? ["Summer", "Été"] : ["Fall", "Automne"];
  return `${lang === "fr" ? season[1] : season[0]} ${year}`;
}

function heardFrom(source: string | null, lang: Lang): string {
  if (source === "linkedin") return "LinkedIn";
  if (source === "indeed") return "Indeed";
  return lang === "fr" ? "Site web de l'entreprise" : "Company website";
}

function inMontrealArea(location: string | null): boolean {
  return !!location && /montr[eé]al|laval|saint-?laurent|vaudreuil/i.test(location);
}

// A box that only lets this application be processed: the privacy notice for recruiting, the terms of the application
// form, "the information I gave is accurate". Anything that reaches further (marketing, a talent pool, a background or
// credit check, sharing with third parties, arbitration, a non-compete) stays yours.
const APPLICATION_CONSENT =
  /privacy|confidentialite|personal (data|information)|donnees personnelles|renseignements personnels|process|traitement|terms|conditions|accurate|true|complete|exact|veridique|certif|attest|acknowledge|read and (agree|accept|understand)|j ai lu|recruit|recrutement|application|candidature/;
const BEYOND_THE_APPLICATION =
  /marketing|newsletter|infolettre|promotion|sms|text message|texto|talent (pool|community|network)|bassin de talents|future (opportunit|opening|job|role|position)|futures? (offres|possibilites)|job alert|alerte|background|antecedents|credit|drug|drogue|criminal|casier|reference check|non.?compet|non.?concurrence|non.?solicit|arbitration|arbitrage|third part|tiers|partner|partenaire|sell|vendre/;

function applicationConsent(field: FormField): string | null {
  if (!field.required) return null;
  const l = norm(cleanLabel(field.label));
  if (!APPLICATION_CONSENT.test(l) || BEYOND_THE_APPLICATION.test(l)) return null;
  if (field.kind === "checkbox") return "Yes";
  if (CHOICE_KINDS.has(field.kind) && isYesNoOptionSet(field.options)) return matchOption("Yes", field.options)?.option ?? null;
  return null;
}

// Levels your CV states ("French (fluent)"), best first; never "native", which the CV does not say.
const FLUENT_LEVELS = [/^fluent\b/, /^courant/, /bilingu/, /full professional/, /^advanced\b|^avance/, /professional working/];
const NOT_A_LEVEL = /\b(not|non|pas|basic|beginner|debutant|elementary|limited|notions?)\b/;

function cvSaysFluent(candidate: CandidateProfile, which: "English" | "French"): boolean {
  const name = which === "English" ? "(english|anglais)" : "(french|fran[cç]ais)";
  return !!candidate.resumeText && new RegExp(`${name}\\s*\\(\\s*(fluent|courant)`, "i").test(candidate.resumeText);
}

function fluentOption(options: string[]): string | null {
  const opts = realOptions(options).map((o) => o.text);
  for (const level of FLUENT_LEVELS) {
    const hit = opts.find((o) => level.test(norm(o)) && !NOT_A_LEVEL.test(norm(o)));
    if (hit) return hit;
  }
  return null;
}

const POSTAL_CODE = /\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])\s?(\d[ABCEGHJ-NPRSTV-Z]\d)\b/i;

function base(field: FormField, candidate: CandidateProfile, job: JobContext, files: FileContext, intent: FieldIntent, opts: ResolveOptions): Outcome {
  const c = candidate;
  const lang = c.lang;
  const val = (v: string | null, what: string, source: FieldSource = "bank"): Outcome =>
    v ? resolved(v, source, `${what} from your ${source === "profile" ? "CV" : "answer bank"}.`) : unavailable(field, what);

  if (PERSON_ONLY_INTENTS.has(intent)) {
    const reason = REASON_BY_INTENT[intent] ?? PERSON_ONLY_REASON;
    // What you wrote in your answer bank is offered pre-selected, never filled: it stays yours to confirm.
    const suggestion = personalSuggestion(field, intent, c, job.location, job.companyName);
    if (suggestion?.confirmed) {
      return resolved(
        suggestion.value,
        "bank",
        suggestion.why ?? `From your answer bank (${suggestion.what}): confirmed once on the Answers page to be used automatically.`,
      );
    }
    if (suggestion && opts.autoConfirm) {
      // Voluntary self-identification nobody has to answer is still left blank: less personal data in a form is better.
      if (intent === "demographic" && !field.required) {
        return { value: null, source: "none", status: "skipped", reason: `${reason} Optional, left blank.` };
      }
      return resolved(suggestion.value, "bank", `From your answer bank (${suggestion.what}), filled automatically (PORTAL_AUTO_CONFIRM_PERSONAL=true).`);
    }
    if (opts.autoConfirm && (intent === "consent" || intent === "legal_declaration")) {
      const agree = applicationConsent(field);
      if (agree) return resolved(agree, "derived", "Required consent to process this application (privacy notice / accurate information), ticked automatically (PORTAL_AUTO_CONFIRM_PERSONAL=true).");
    }
    if (suggestion) {
      return {
        value: suggestion.value,
        source: "bank",
        status: "manual",
        reason: `From your answer bank (${suggestion.what}). Confirm it: nothing personal is filled without you.`,
      };
    }
    // Voluntary questions nobody has to answer stay blank rather than guessed.
    if (!field.required && (intent === "demographic" || intent === "referral")) {
      return { value: null, source: "none", status: "skipped", reason: `${reason} Optional, left blank.` };
    }
    return manual(reason);
  }

  switch (intent) {
    case "first_name":
      return val(c.firstName, "First name");
    case "last_name":
      return val(c.lastName, "Last name");
    case "full_name":
      return val(c.fullName, "Full name");
    case "preferred_name":
      return field.required
        ? manual("Preferred name is not written down anywhere.", c.firstName)
        : { value: null, source: "none", status: "skipped", reason: "Optional preferred name, left blank." };
    case "email":
      return val(c.email, "Email");
    case "phone":
      return val(c.phone, "Phone");
    case "city":
      return val(c.city, "City");
    case "region":
      return val(c.regionName ?? c.region, "Province");
    case "country":
      return c.country ? resolved(c.country, "derived", `Country from your province (${c.region}).`) : unavailable(field, "Country");
    case "location":
      return c.city
        ? resolved([c.city, c.regionName, c.country].filter(Boolean).join(", "), "derived", "Location from your answer bank.")
        : unavailable(field, "Location");
    case "address":
      return unavailable(field, "Street address");
    case "postal_code": {
      const pc = c.resumeText?.match(POSTAL_CODE);
      return pc ? resolved(`${pc[1]} ${pc[2]}`.toUpperCase(), "profile", "Postal code from your CV.") : unavailable(field, "Postal code");
    }
    case "linkedin":
      return val(c.links.linkedin, "LinkedIn");
    case "github":
      return val(c.links.github, "GitHub");
    case "portfolio":
    case "website":
      return val(c.links.portfolio, "Portfolio");
    case "school":
      return val(c.education.school, "School");
    case "degree":
      return val(c.education.credential, "Diploma");
    case "discipline":
      return val(c.education.program, "Program");
    case "graduation_year":
      return c.education.graduationYear
        ? resolved(String(c.education.graduationYear), "derived", `Graduation year: ${c.education.graduation}.`)
        : unavailable(field, "Graduation year");
    case "graduation_date":
      return dateFor(field, c.education.graduationYear, c.education.graduationMonth, c.education.graduation, "Graduation date");
    case "education_start":
      return c.education.startYear
        ? resolved(String(c.education.startYear), "derived", "Program start year from your answer bank.")
        : unavailable(field, "Program start");
    case "gpa":
      return unavailable(field, "GPA");
    case "available_from":
      return dateFor(field, c.availableYear, c.availableMonth, c.availableFrom, "Start availability");
    case "internship_term": {
      const term = termName(c.availableMonth, c.availableYear, lang);
      return term ? resolved(term, "derived", `Term from your availability (${c.availableFrom}).`) : unavailable(field, "Internship term");
    }
    case "internship_duration":
      return unavailable(field, "Internship length");
    case "languages":
      if (field.kind === "checkbox-group") {
        return c.languages.length ? resolved(c.languages.join("|"), "bank", "Languages from your answer bank.") : unavailable(field, "Languages");
      }
      return val(c.languagesText, "Languages");
    case "language_level_en":
    case "language_level_fr": {
      const which = intent === "language_level_en" ? "English" : "French";
      const speaks = c.languages.includes(which);
      const opts = realOptions(field.options).map((o) => o.text);
      if (opts.length > 0 && opts.length <= 3 && matchOption("yes", opts) && matchOption("no", opts)) {
        return speaks ? resolved("Yes", "bank", `You speak ${which} (answer bank).`) : unavailable(field, `${which} level`);
      }
      const level = speaks && cvSaysFluent(c, which) ? (opts.length ? fluentOption(field.options) : c.lang === "fr" ? "Courant" : "Fluent") : null;
      if (level) return resolved(level, "profile", `Your CV says ${which} (fluent).`);
      return manual(`Your answer bank says "${c.languagesText ?? "—"}" but gives no level for ${which}.`);
    }
    case "how_heard": {
      const v = heardFrom(job.source, lang);
      return resolved(v, "derived", `Where this posting was found (${job.source ?? "company board"}).`);
    }
    case "onsite_ok":
      if (job.workplaceType === "remote") return resolved("Yes", "derived", "Remote role: fits your location rule.");
      if (inMontrealArea(job.location)) return resolved("Yes", "derived", `Montréal-area role: your location rule is "${c.locationRule}".`);
      return manual(`Role location "${job.location ?? "unknown"}" is outside your stated location rule.`);
    case "relocation":
      return manual("Relocation is not covered by your location rule.");
    case "years_experience": {
      const asked = extractSkillsFromText(field.label);
      const missing = asked.filter((sk) => !candidateHasSkill(c, sk));
      return manual(
        missing.length
          ? `${missing.join(", ")} is not in your CV or projects: pick the level yourself.`
          : "Experience level is a judgment call: pick it yourself.",
      );
    }
    case "skill_yes_no": {
      const asked = extractSkillsFromText(field.label);
      if (asked.length === 0) return manual("Could not tell which skill this asks about.");
      const missing = asked.filter((s) => !candidateHasSkill(c, s));
      if (missing.length) return manual(`${missing.join(", ")} is not in your CV or projects: answer it yourself.`);
      return resolved("Yes", "profile", `${asked.join(", ")} appears in your CV/projects.`);
    }
    case "resume":
      return files.resumePath
        ? { value: files.resumePath, source: "file", status: "resolved", reason: "CV chosen for this role." }
        : manual("No active CV matches this posting. Upload one on /resumes.");
    case "cover_letter_file":
      if (files.coverLetterPath) return { value: files.coverLetterPath, source: "file", status: "resolved", reason: "Cover letter built for this application." };
      return field.required ? manual("Cover letter required but could not be built.") : { value: null, source: "none", status: "skipped", reason: "Optional, no cover letter." };
    case "cover_letter_text": {
      const text = files.coverLetterText;
      if (!text) return unavailable(field, "Cover letter text");
      if (field.maxLength && text.length > field.maxLength) {
        return manual(`Cover letter is ${text.length} characters; the field allows ${field.maxLength}.`);
      }
      return { value: text, source: "file", status: "resolved", reason: "Cover letter built for this application." };
    }
    case "transcript":
      return unavailable(field, "Transcript");
    case "other_file":
      return unavailable(field, "This attachment");
    case "open_question":
      return { value: null, source: "none", status: "manual", reason: "Written answer: handled by the answer engine." };
    default:
      if (isYesNoOptionSet(field.options)) {
        return field.required
          ? manual("A yes/no question your data does not answer: pick it yourself.")
          : { value: null, source: "none", status: "skipped", reason: "Optional yes/no question your data does not answer, left blank." };
      }
      return field.required
        ? manual("Unrecognized required question: answer it yourself.")
        : { value: null, source: "none", status: "skipped", reason: "Optional and unrecognized, left blank." };
  }
}

/**
 * The decision for one non-written field. For choice fields the value is mapped
 * onto one of the form's own options; when nothing matches clearly, a person picks.
 */
export function resolveField(
  field: FormField,
  intent: FieldIntent,
  candidate: CandidateProfile,
  job: JobContext,
  files: FileContext,
  opts: ResolveOptions = {},
): Pick<FieldDecision, "source" | "value" | "status" | "reason"> {
  const out = base(field, candidate, job, files, intent, opts);
  const hasOptions = realOptions(field.options).length > 0;
  if (!out.value || !CHOICE_KINDS.has(field.kind) || !hasOptions) return out;

  if (field.kind === "checkbox-group") {
    const picks = out.value.split("|").map((v) => matchOption(v, field.options));
    if (picks.some((p) => !p)) {
      return { ...out, status: out.status === "skipped" ? "skipped" : "manual", reason: `${out.reason} Not every value matches an option.` };
    }
    return { ...out, value: picks.map((p) => p!.option).join("|") };
  }

  const m = matchOption(out.value, field.options);
  if (!m) {
    const status: FieldStatus = out.status === "resolved" ? "manual" : out.status;
    return { ...out, status, reason: `${out.reason} No option clearly matches "${out.value}": pick one.`, value: out.status === "resolved" ? null : out.value };
  }
  return { ...out, value: m.option, reason: `${out.reason} Option "${m.option}" (${m.strategy}).` };
}
