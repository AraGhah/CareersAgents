// Personal and legal questions (work authorization, sponsorship, voluntary self-identification, pay, past
// employment) are a person's to answer: the desk never fills them by itself. What this adds is a *suggestion*
// from what you wrote in your answer bank, shown pre-selected on the application page for one click to confirm.
// The plan stays "À toi" and the submit stays blocked until you have clicked, so nothing personal reaches a form
// without you.
//
// A wrong suggestion on a legal question is worse than none, so a suggestion is made only when the question is
// clearly one of these and the stored answer clearly fits it:
//   - "authorized to work in the United States?" is not answered from a Canadian citizenship
//   - "are you a citizen of another country?" and "do you require a work permit?" are different questions
//   - a single tick-box is never suggested: its own text may be the negative ("I am not a protected veteran")
//   - a choice is mapped onto the form's own option, and a tie or "prefer not to answer" is never picked
//
// Work authorization and sponsorship can be confirmed once, on the Answers page ("use it automatically"): from then on
// they are filled without a click, with the same strict matching (only about Canada, only an option that fits).
//
// Previous employment is answered from the CV: "Have you worked at <company> before?" is "No" when the company appears
// nowhere in the CV's text or experience, and stays yours otherwise.
//
// One exception to "you confirm it": the two screening topics (criminal record, security issues). Ara told the desk
// directly that there is nothing there and asked it to answer them, so once the answer bank holds that statement
// they are filled without a click. They stay as strict as the rest about *which* questions they answer (below).

import { cleanLabel, norm } from "./text";
import { isYesNoOptionSet, matchOption, realOptions } from "./options";
import type { CandidateProfile } from "./candidate";
import type { FieldIntent, FormField } from "./types";

export type PersonalTopic =
  | "work_authorization"
  | "sponsorship"
  | "salary"
  | "employed_before"
  | "gender"
  | "ethnicity"
  | "hispanic"
  | "disability"
  | "indigenous"
  | "visible_minority"
  | "veteran"
  | "lgbtq"
  | "criminal_record"
  | "security";

/** Answer-bank keys (category "red") each topic reads. The values live in the database, not in the repository. */
export const PERSONAL_BANK_KEYS: Record<PersonalTopic, string> = {
  work_authorization: "work_authorization",
  sponsorship: "sponsorship_required",
  salary: "salary_expectation",
  employed_before: "previous_employment",
  gender: "gender",
  ethnicity: "ethnicity",
  hispanic: "hispanic_latino",
  disability: "disability",
  indigenous: "indigenous",
  visible_minority: "visible_minority",
  veteran: "veteran",
  lgbtq: "lgbtq",
  criminal_record: "criminal_record_check",
  security: "security_clearance",
};

/** Topics the owner pre-confirmed by writing the statement down (see the note at the top). */
const PRECONFIRMED: ReadonlySet<PersonalTopic> = new Set<PersonalTopic>(["criminal_record", "security"]);

/** The stored statement says "nothing there" ("No criminal record.", "No security issues.", "Aucun ..."). Anything else is not used. */
const NOTHING_THERE = /^\s*(no|none|non|aucun|aucune|sans|nil)\b/i;

const CRIMINAL_TERM = /criminal|casier|convict|condamn|felony|judicial record|antecedents judiciaires/;
const SECURITY_TERM =
  /security (clearance|screening|check|issue|concern|problem)|reliability status|background (check|screening|investigation)|cote de securite|enquete de securite|verification (des antecedents|de securite)|probleme de securite/;

/** Wording that turns a screening question around or asks for something else (clean record, willing to undergo, provide, hold, pending charges). */
const NOT_PLAIN =
  /\b(clean|vierge|free (of|from)|without|willing|consent|agree|authori[sz]e|undergo|submit|provide|supply|certify|attest|declare|accept|charges?|pending|hold|possess|detenez|possedez|disposee?|accepte|fournir|traffic|speeding|parking|driving|impaired|dui)\b|aucun casier|sans casier|no criminal|code de la route/;

/**
 * For the two screening topics: which one the question is, and what Ara's statement answers. `l` is norm()ed.
 *   "Do you have a criminal record?" / "Have you ever been convicted of ...?"               → No
 *   "Is there any security issue / reason that would prevent a clearance?"                  → No
 *   "Are you able to obtain / pass a security clearance or a background check?"             → Yes
 * Anything else (willing to undergo a check, "do you hold a clearance", a clean-record certificate, a pending
 * charge, "unable to ...") is not answered: null, so a person decides.
 */
export function screeningQuestion(l: string): { topic: "criminal_record" | "security"; want: "Yes" | "No" } | null {
  const criminal = CRIMINAL_TERM.test(l);
  const security = SECURITY_TERM.test(l);
  if (!criminal && !security) return null;
  if (NOT_PLAIN.test(l)) return null;

  const topic = criminal ? "criminal_record" : "security";
  const asks = /\b(do you|have you|has|are you|were you|did you|is there|are there|avez vous|etes vous|as tu|y a t il)\b/.test(l);
  const issue = /\b(issues?|concerns?|problems?|reasons?|prevent|barriers?|obstacles?|impediments?|disqualif\w*|probleme|empech\w*|raison)\b/.test(l);
  const able = /\b(able to|eligible|capable of|qualify|can you|could you|pouvez vous|admissible)\b/.test(l) && (security || /\b(obtain|pass|get)\b/.test(l));
  const negated = /\b(not|unable|cannot|can't|never|pas)\b/.test(l);

  // "Is there any reason you would not be able to ..." is about a problem, so it is checked before the ability form.
  if (asks && issue) return { topic, want: "No" };
  if (able) return negated ? null : { topic, want: "Yes" };
  if (criminal && asks) return { topic, want: "No" };
  return null;
}

const label = (f: FormField) => norm(cleanLabel(f.label));

/** Which of these a person-only question is, or null when it is anything else (or several things at once). */
export function personalTopic(intent: FieldIntent, field: FormField): PersonalTopic | null {
  const l = label(field);
  switch (intent) {
    case "work_authorization": {
      const asksAuthorization = /authori[sz]|eligib|entitled|legally|right to work|autoris|admissible|droit de travailler/.test(l);
      const asksStatus = /citizen|citoyen|permanent resident|resident permanent|work status|statut/.test(l);
      if (!asksAuthorization && !asksStatus) return null;
      // "Do you require a work permit / visa?" is a different question from "are you authorized".
      if (/\b(require|need|besoin|exig)/.test(l) && /permit|permis|visa/.test(l)) return null;
      // "Are you a citizen of another country?" is not answered from a Canadian citizenship.
      if (/citizen|citoyen/.test(l) && !/canad/.test(l)) return null;
      return "work_authorization";
    }
    case "sponsorship":
      return /sponsor|parrain/.test(l) && /(require|need|besoin|exig|necessit|now or|future|futur|will you|would you|do you|avez)/.test(l)
        ? "sponsorship"
        : null;
    case "salary":
      return "salary";
    case "previous_employment":
      // Non-compete and non-solicit agreements are a different question from "have you worked here before".
      if (/non.?compet|non.?concurrence|non.?solicit/.test(l)) return null;
      return /(ever|previous|formerly|former|ancien|deja|already)/.test(l) ? "employed_before" : null;
    case "demographic": {
      const hits = (
        [
          ["lgbtq", /sexual orientation|orientation sexuelle|lgbt|2slgbt|lgbq|queer/],
          ["veteran", /veteran|military service|armed forces|forces armees/],
          ["disability", /disab|handicap/],
          ["indigenous", /indigenous|autochtone|aboriginal|first nations|premieres nations|inuit|metis/],
          ["visible_minority", /visible minorit|minorite visible|racialized|racise/],
          ["ethnicity", /\brace\b|racial|ethnic|ethni/],
          ["hispanic", /hispanic|latin[oax]/],
          ["gender", /\bgender\b|\bgenre\b|\bsexe\b/],
        ] as Array<[PersonalTopic, RegExp]>
      ).filter(([, re]) => re.test(l));
      // "Race / Ethnicity (Hispanic or Latino ...)" is the ethnicity question; two unrelated topics are ambiguous.
      const topics = new Set(hits.map(([t]) => t));
      if (topics.has("ethnicity")) topics.delete("hispanic");
      return topics.size === 1 ? [...topics][0] : null;
    }
    case "sensitive":
      return screeningQuestion(l)?.topic ?? null;
    default:
      return null;
  }
}

/** Other countries a legal question can be about; the stored answers are about Canada only. */
const OTHER_COUNTRY =
  /\b(united states|usa|u s a?|united kingdom|great britain|europe|european union|australia|new zealand|germany|ireland|mexico|india|china|japan|singapore|netherlands|switzerland|france)\b/;
const IN_CANADA = /canada|qu[eé]bec|\bqc\b|montr|laval|longueuil|gatineau|sherbrooke|hyacinthe/i;

/** The question is about the country the candidate lives in, whatever the job's location ("where you live"). */
const RESIDENCE =
  /country (where|in which) you (currently )?(live|reside)|country of (your )?(current )?residence|your country of residence|your (home )?country|where you (currently )?(live|reside)|pays (de|ou vous) (residence|residez|vivez|habitez)|votre pays/;

/** The question is about Canada: it names Canada or the country you live in, or names no country and the job is in Canada. */
export function aboutCanada(l: string, jobLocation: string | null): boolean {
  if (OTHER_COUNTRY.test(l)) return false;
  if (/canad/.test(l) || RESIDENCE.test(l)) return true;
  return !!jobLocation && IN_CANADA.test(jobLocation);
}

/**
 * The option that says what a stored status says, in the form's own words: "Canadian citizen" → "I am authorized to work
 * in the country due to my nationality"; "Permanent resident" → the permanent-residence option. Null when none clearly fits.
 */
function statusOption(stored: string, options: string[]): string | null {
  const opts = realOptions(options).map((o) => o.text);
  const n = (s: string) => norm(s);
  const citizen = /citizen|citoyen|nationalit/.test(n(stored));
  const resident = /permanent resident|resident permanent/.test(n(stored));
  const hits = opts.filter((o) => {
    const t = n(o);
    if (/\b(not|no|non|pas|without|sans)\b|permit|permis|visa|sponsor|parrain|student|etudiant|refugee|refugie/.test(t)) return false;
    if (citizen) return /citizen|citoyen|nationalit/.test(t);
    if (resident) return /permanent resident|resident permanent|permanent residence|residence permanente/.test(t);
    return false;
  });
  return hits.length === 1 ? hits[0] : null;
}

/** Employers named in the CV, as normalized text, to tell whether the candidate ever worked at a company. */
function workedAt(candidate: CandidateProfile, companyName: string | null): boolean | null {
  if (!companyName || !candidate.resumeText) return null;
  const company = norm(companyName).replace(/[^a-z0-9 ]+/g, " ").replace(/\b(inc|ltd|ltee|llc|corp|corporation|group|groupe|canada)\b/g, " ").replace(/\s+/g, " ").trim();
  if (company.length < 3) return null;
  const cv = norm([candidate.resumeText, ...candidate.experience.map((e) => JSON.stringify(e))].join(" "));
  return cv.includes(company);
}

const CHOICE = new Set<FormField["kind"]>(["select", "radio", "combobox"]);

/** `confirmed`: the owner already vouched for this one (the screening topics), so it needs no click. */
export type PersonalSuggestion = { value: string; what: string; confirmed?: boolean; why?: string };

// Read against norm() output, which turns "N/A" into "n a".
const NOT_APPLICABLE = /^(n ?a|not applicable|does not apply|doesn'?t apply|none|no expiry|no expiration|sans objet|ne s'?applique pas|non applicable|aucune?|i am a (canadian )?citizen|canadian citizen|citoyen canadien)$/;
const ASKS_NEED = /\b(require|requires|need|needs|besoin|exig\w*|necessit\w*)\b/;
const CITIZENSHIP_QUESTION = /citizenship|citoyennete|nationalit|country of (citizenship|nationality)|pays de citoyennete/;
const OTHER_CITIZENSHIP = /\b(other|another|dual|second|additional|any other|autre|double|deuxieme)\b/;

/**
 * Answers that follow from a Canadian citizenship (candidate.authorization), about Canada only:
 *   "Do you require a visa / work permit to work in Canada?"            → No
 *   "What is your citizenship / country of citizenship / nationality?" → Canadian (Canada in a country list)
 *   "When does your visa / work permit / authorization expire?"        → the form's "Not applicable" option, or
 *                                                                         "Not applicable (Canadian citizen)" in a text box;
 *                                                                         never a date (a date-only field stays yours)
 * Undefined: not one of these questions (the regular topics decide). Null: one of these, with no truthful answer to give.
 */
function citizenshipAnswer(field: FormField, intent: FieldIntent, candidate: CandidateProfile, jobLocation: string | null): PersonalSuggestion | null | undefined {
  const auth = candidate.authorization;
  const l = label(field);
  const choice = CHOICE.has(field.kind) && realOptions(field.options).length > 0;
  const text = field.kind === "text" || field.kind === "textarea";
  const fr = candidate.lang === "fr";
  const confirmed = candidate.autoUse.has("work_authorization");
  const what = `work authorization: "${candidate.personal.work_authorization ?? "—"}"`;

  if (intent === "authorization_expiry") {
    if (auth.status !== "citizen") return null;
    if (choice) {
      const na = realOptions(field.options).find((o) => NOT_APPLICABLE.test(norm(o.text).replace(/[.\s]+$/, "")));
      return na ? { value: na.text, what, confirmed, why: `"${na.text}": a Canadian citizen has no work authorization that expires.` } : null;
    }
    if (text) return { value: fr ? "Sans objet (citoyen canadien)" : "Not applicable (Canadian citizen)", what, confirmed, why: "A Canadian citizen has no work authorization that expires." };
    // A date box: no date is true. A required one stays yours (the planner flags it); an optional one stays empty.
    return null;
  }

  if ((intent === "sponsorship" || intent === "work_authorization") && ASKS_NEED.test(l) && /\b(visa|permit|permis)\b/.test(l) && !/sponsor|parrain/.test(l)) {
    if (auth.canada.requiresWorkPermit !== false || !aboutCanada(l, jobLocation)) return null;
    if (field.kind === "checkbox" || field.kind === "checkbox-group") return null;
    if (choice) {
      const m = isYesNoOptionSet(field.options) ? matchOption("No", field.options) : null;
      return m ? { value: m.option, what, confirmed, why: "No: a Canadian citizen needs no visa or work permit to work in Canada." } : null;
    }
    return text ? { value: fr ? "Non" : "No", what, confirmed, why: "A Canadian citizen needs no visa or work permit to work in Canada." } : null;
  }

  if (intent === "work_authorization" && CITIZENSHIP_QUESTION.test(l) && !/canad/.test(l) && !OTHER_CITIZENSHIP.test(l)) {
    if (!auth.citizenship || (choice && isYesNoOptionSet(field.options))) return null;
    if (choice) {
      const m = matchOption("Canada", field.options) ?? matchOption("Canadian", field.options) ?? matchOption("Canadienne", field.options);
      return m ? { value: m.option, what, confirmed, why: "Your citizenship: Canadian." } : null;
    }
    return text ? { value: fr ? "Canadienne" : "Canadian", what, confirmed, why: "Your citizenship: Canadian." } : null;
  }
  return undefined;
}

/** The value to offer for this question, already mapped onto the form's own option, or null. */
export function personalSuggestion(
  field: FormField,
  intent: FieldIntent,
  candidate: CandidateProfile,
  jobLocation: string | null,
  companyName: string | null = null,
): PersonalSuggestion | null {
  const derived = citizenshipAnswer(field, intent, candidate, jobLocation);
  if (derived !== undefined) return derived;
  const topic = personalTopic(intent, field);
  if (!topic) return null;

  if (topic === "employed_before") {
    // Answered from the CV: a company the CV never mentions is one the candidate never worked at ("No", no click). One the
    // CV names stays yours; without a CV to read, the stored answer is only suggested, as before.
    const worked = workedAt(candidate, companyName);
    if (worked === true) return null;
    const choice = CHOICE.has(field.kind) && isYesNoOptionSet(field.options);
    if (worked === false && choice) {
      const m = matchOption("No", field.options);
      if (m) return { value: m.option, what: "previous employment", confirmed: true, why: `"No": ${companyName} appears nowhere in your CV.` };
    }
  }

  const stored = candidate.personal[topic];
  if (!stored) return null;
  const l = label(field);
  // A single tick-box carries its own statement ("I am not a protected veteran"): ticking or not is not "No".
  if (field.kind === "checkbox" || field.kind === "checkbox-group") return null;

  const choice = CHOICE.has(field.kind) && realOptions(field.options).length > 0;
  const text = field.kind === "text" || field.kind === "textarea";
  if (!choice && !text) return null;

  if (PRECONFIRMED.has(topic)) {
    // Only a yes/no choice, and only while the stored statement still says "nothing there": if it is ever
    // changed to something else, these go back to being the person's to answer.
    if (!NOTHING_THERE.test(stored) || !choice || !isYesNoOptionSet(field.options)) return null;
    const want = screeningQuestion(l)?.want;
    const m = want ? matchOption(want, field.options) : null;
    const what = `${topic.replace(/_/g, " ")}: "${stored}"`;
    return m ? { value: m.option, what, confirmed: true, why: `From your answer bank (${what}): you told the desk this yourself.` } : null;
  }

  if ((topic === "work_authorization" || topic === "sponsorship") && !aboutCanada(l, jobLocation)) return null;

  let want = stored;
  if (topic === "work_authorization") {
    // "Are you authorized to work in Canada?" is a yes/no; "Work status" wants the status itself.
    const yesNo = choice ? isYesNoOptionSet(field.options) : /^(are|do|does|is|etes|avez|peut)\b|\?$/.test(l);
    want = yesNo ? "Yes" : stored;
  }
  if (topic === "salary" && !text) return null;

  // Confirmed once on the Answers page ("use it automatically"): work authorization, sponsorship, and the salary line.
  const confirmed = (topic === "work_authorization" || topic === "sponsorship" || topic === "salary") && candidate.autoUse.has(topic);
  const what = `${topic.replace(/_/g, " ")}: "${stored}"`;
  if (choice) {
    const m = matchOption(want, field.options);
    const option = m?.option ?? (topic === "work_authorization" ? statusOption(stored, field.options) : null);
    return option ? { value: option, what, confirmed } : null;
  }
  return { value: want, what, confirmed };
}
