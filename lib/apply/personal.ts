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
  | "lgbtq";

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
};

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
    default:
      return null;
  }
}

/** Other countries a legal question can be about; the stored answers are about Canada only. */
const OTHER_COUNTRY =
  /\b(united states|usa|u s a?|united kingdom|great britain|europe|european union|australia|new zealand|germany|ireland|mexico|india|china|japan|singapore|netherlands|switzerland|france)\b/;
const IN_CANADA = /canada|qu[eé]bec|\bqc\b|montr|laval|longueuil|gatineau|sherbrooke|hyacinthe/i;

/** The question is about Canada: it names Canada, or names no country and the job is in Canada. */
function aboutCanada(l: string, jobLocation: string | null): boolean {
  if (OTHER_COUNTRY.test(l)) return false;
  if (/canad/.test(l)) return true;
  return !!jobLocation && IN_CANADA.test(jobLocation);
}

const CHOICE = new Set<FormField["kind"]>(["select", "radio", "combobox"]);

export type PersonalSuggestion = { value: string; what: string };

/** The value to offer for this question, already mapped onto the form's own option, or null. */
export function personalSuggestion(
  field: FormField,
  intent: FieldIntent,
  candidate: CandidateProfile,
  jobLocation: string | null,
): PersonalSuggestion | null {
  const topic = personalTopic(intent, field);
  if (!topic) return null;
  const stored = candidate.personal[topic];
  if (!stored) return null;
  const l = label(field);
  // A single tick-box carries its own statement ("I am not a protected veteran"): ticking or not is not "No".
  if (field.kind === "checkbox" || field.kind === "checkbox-group") return null;

  const choice = CHOICE.has(field.kind) && realOptions(field.options).length > 0;
  const text = field.kind === "text" || field.kind === "textarea";
  if (!choice && !text) return null;

  if ((topic === "work_authorization" || topic === "sponsorship") && !aboutCanada(l, jobLocation)) return null;

  let want = stored;
  if (topic === "work_authorization") {
    // "Are you authorized to work in Canada?" is a yes/no; "Work status" wants the status itself.
    const yesNo = choice ? isYesNoOptionSet(field.options) : /^(are|do|does|is|etes|avez|peut)\b|\?$/.test(l);
    want = yesNo ? "Yes" : stored;
  }
  if (topic === "salary" && !text) return null;

  if (choice) {
    const m = matchOption(want, field.options);
    return m ? { value: m.option, what: `${topic.replace(/_/g, " ")}: "${stored}"` } : null;
  }
  return { value: want, what: `${topic.replace(/_/g, " ")}: "${stored}"` };
}
