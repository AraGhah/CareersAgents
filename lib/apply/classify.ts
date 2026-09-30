// Field label → what the form is asking for. Rules run top to bottom and the first
// hit wins, so the order is the safety policy: anything legal, sensitive or
// demographic is recognized before any rule that could fill it. Patterns are
// written against norm() output (lowercase, no accents).

import { isYesNoOptionSet } from "./options";
import { cleanLabel, norm, wordCount } from "./text";
import type { FieldIntent, FormField, QuestionType } from "./types";

type Rule = { intent: FieldIntent; test: RegExp; kinds?: FormField["kind"][] };

const FILE_RULES: Rule[] = [
  { intent: "cover_letter_file", test: /cover ?letter|lettre (de )?(motivation|presentation)|motivation letter/ },
  { intent: "resume", test: /resume|cv\b|curriculum|c v\b/ },
  { intent: "transcript", test: /transcript|releve de notes|bulletin|grades/ },
];

/** Never filled by the desk: a person answers these, every time. */
const PERSON_ONLY: Rule[] = [
  {
    intent: "demographic",
    test: /\bgender\b|\bgenre\b|\bsexe\b|pronoun|pronom|\brace\b|ethnic|ethni|hispanic|latin[oax]|veteran|disab|handicap|sexual orientation|orientation sexuelle|indigenous|autochtone|aboriginal|first nations|premieres nations|visible minorit|minorite visible|self.?identif|auto.?identif|equity|equite|diversity|diversite|lgbt|transgender|\beeo\b|equal employment/,
  },
  {
    intent: "sensitive",
    test: /date of birth|birth ?date|date de naissance|\bage\b|how old|social insurance|\bsin\b|\bnas\b|social security|\bssn\b|passport|passeport|driver'?s? licen|permis de conduire|marital|etat civil|religio|criminal|casier|convicted|condamn|background check|antecedents|security clearance|cote de securite|\bhealth\b|medical|medic|sante/,
  },
  { intent: "salary", test: /salary|compensation|pay expectation|expected pay|remuneration|salaire|hourly rate|taux horaire|wage/ },
  { intent: "sponsorship", test: /sponsor|\bvisa\b|parrainage/ },
  {
    intent: "work_authorization",
    test: /authori[sz]ed to work|legally (able|eligible|entitled|permitted)|eligible to work|eligibility to work|right to work|work permit|study permit|permis (de travail|d'etudes)|autorisation (de|a) travailler|autorise a travailler|citizen|citoyen|permanent resident|resident permanent|immigration|work status|statut (legal|au canada)/,
  },
  {
    intent: "legal_declaration",
    test: /certify|attest|truthful|true and (complete|correct|accurate)|accurate and complete|je certifie|j'atteste|exacte?s? et complete?s?|declaration|affirm that|under penalty/,
  },
  {
    intent: "consent",
    test: /consent|consens|i agree|i accept|j'accepte|acknowledge|privacy (policy|notice|statement)|politique de confidentialite|terms (of|and)|conditions (d'utilisation|generales)|data (processing|protection|retention)|donnees personnelles|gdpr|rgpd|loi 25|talent (pool|community)|future (opportunities|openings)/,
  },
  {
    intent: "previous_employment",
    test: /(previously|ever|currently|already|formerly) (been )?(worked|employed|work)|former employee|ancien(ne)? employe|deja (travaille|ete employe)|non.?compet|non.?concurrence|non.?solicit/,
  },
  {
    intent: "referral",
    test: /referr|refere par|recommande par|who referred|employee referral|referral code|know anyone|relative|family member|lien de parente|conflict of interest|conflit d'interets/,
  },
];

const FACT_RULES: Rule[] = [
  {
    intent: "how_heard",
    test: /how did you (hear|find|learn|come across)|where did you (hear|find|see|learn)|comment (avez.vous|as.tu) (entendu|connu|trouve|decouvert)|ou avez.vous (vu|trouve)|source of (application|referral)|how you heard/,
  },
  { intent: "preferred_name", test: /preferred (first )?name|nom (d'usage|prefere)|prenom (d'usage|prefere)|goes by/ },
  { intent: "first_name", test: /^(legal )?(first|given) name|^prenom|^first$/ },
  { intent: "last_name", test: /^(legal )?(last|family) name|^surname|^nom de famille|^nom$|^last$/ },
  { intent: "full_name", test: /^(your )?(full |legal |complete )?name$|^nom complet|^nom et prenom|^prenom et nom|^full name/ },
  { intent: "email", test: /e.?mail|courriel|adresse electronique/ },
  { intent: "phone", test: /phone|telephone|mobile|\bcell/ },
  { intent: "linkedin", test: /linkedin/ },
  { intent: "github", test: /github|gitlab/ },
  { intent: "portfolio", test: /portfolio|personal (web)?site|site (web )?personnel/ },
  { intent: "website", test: /^website|^site web|other (website|link|url)|^url\b|^links?\b|^liens?\b/ },
  { intent: "postal_code", test: /postal|\bzip\b|code postal/ },
  { intent: "address", test: /street|address line|^address\b|^adresse( postale| civique| de residence)?$|mailing address/ },
  { intent: "country", test: /^country|pays|country of residence/ },
  { intent: "region", test: /^province|^state\b|state.?province|province.?state|^region/ },
  { intent: "city", test: /^city|^ville|municipalit|^town/ },
  {
    intent: "location",
    test: /current location|^location|where are you (located|based)|lieu de residence|ou (habitez|residez)|^localisation/,
  },
  { intent: "gpa", test: /\bgpa\b|grade point|moyenne|cote r\b/ },
  {
    intent: "graduation_year",
    test: /(graduation|grad) year|year of graduation|annee (de|d'obtention du) (diplome|diplomation)|annee de fin d'etudes/,
  },
  {
    intent: "graduation_date",
    test: /graduat|date (de|d'obtention du) (diplome|diplomation)|fin d'etudes|expected completion|completion date/,
  },
  { intent: "education_start", test: /(education|study|studies|program) start|debut des etudes/ },
  { intent: "degree", test: /degree|diplome|credential|level of (education|study)|niveau d'etudes|type of program/ },
  { intent: "discipline", test: /discipline|field of study|major|domaine d'etudes|program of study|programme d'etudes|specializ|concentration/ },
  { intent: "school", test: /school|universit|college|cegep|institution|etablissement|ecole/ },
  {
    intent: "internship_term",
    test: /which (term|semester|session)|(internship|co.?op|work) (term|session|period)|session de stage|trimestre|what term|season/,
  },
  { intent: "internship_duration", test: /duration|how long|length of (the )?(internship|term)|duree|nombre de mois|months? (available|long)/ },
  {
    intent: "available_from",
    test: /start date|available to start|availability|when can you start|earliest (start|date)|date de debut|disponib|date d'entree/,
  },
  {
    intent: "language_level_fr",
    test: /(french|francais).*(proficien|level|niveau|fluen|speak|parl|ecri|written|spoken)|(proficien|level|niveau|fluen|speak|parlez|write).*(french|francais)/,
  },
  {
    intent: "language_level_en",
    test: /(english|anglais).*(proficien|level|niveau|fluen|speak|parl|ecri|written|spoken)|(proficien|level|niveau|fluen|speak|parlez|write).*(english|anglais)/,
  },
  { intent: "languages", test: /languages?( spoken| you speak)?$|langues? (parlees|maitrisees)|which languages|quelles langues/ },
  { intent: "relocation", test: /relocat|demenag|willing to move/ },
  {
    intent: "onsite_ok",
    test: /(on.?site|in.?office|in person|hybrid|commute|presentiel|sur place|au bureau).*(able|willing|comfortable|ok|okay|prepared|capable|pret|disposee?)|(able|willing|comfortable|prepared).*(on.?site|in.?office|in person|hybrid|commute)/,
  },
  {
    intent: "years_experience",
    test: /years of (professional |relevant |work )?experience|annees d'experience|how many years|level of (experience|proficiency|expertise)|niveau d'(experience|expertise|aisance)|proficiency (level|in)/,
  },
];

const SKILL_QUESTION =
  /do you have (experience|knowledge|familiarity)|have you (used|worked|built)|are you (familiar|comfortable|proficient|experienced)|experience (with|in|using)|knowledge of|connaissance|maitrise|avez.vous (de l'experience|deja utilise|travaille)/;

const OPEN_CUE =
  /\?$|^(why|what|how|describe|tell|explain|share|give|provide|walk|please (describe|explain|tell|share))\b|pourquoi|decri|parlez|expliquez|presentez|racontez|qu'est.ce|quel(le)?s? (est|sont)|comment/;

function hasYesNoOptions(field: FormField): boolean {
  return isYesNoOptionSet(field.options);
}

const CHOICE_KINDS: ReadonlySet<FormField["kind"]> = new Set(["select", "radio", "checkbox-group", "combobox"]);

/** Intents whose value is a piece of text (a school name, a city): never the answer to a yes/no question. */
const VALUE_INTENTS: ReadonlySet<FieldIntent> = new Set<FieldIntent>([
  "first_name", "last_name", "full_name", "preferred_name", "email", "phone", "city", "region", "country", "location",
  "address", "postal_code", "linkedin", "github", "portfolio", "website", "school", "degree", "discipline",
  "graduation_date", "graduation_year", "education_start", "gpa", "available_from", "internship_duration", "languages",
]);

/** A group label ("Address") over several inputs: the placeholder or name says which part each one is. */
function subFieldIntent(field: FormField): FieldIntent | null {
  for (const raw of [field.placeholder, field.name]) {
    if (!raw) continue;
    const t = norm(raw.replace(/[_\-\[\]]+/g, " "));
    if (/postal|\bzip\b/.test(t)) return "postal_code";
    if (/\bcity\b|\bville\b|\btown\b/.test(t)) return "city";
    if (/province|\bstate\b|\bregion\b/.test(t)) return "region";
    if (/country|\bpays\b/.test(t)) return "country";
    if (/street|address|adresse|\brue\b/.test(t)) return "address";
  }
  return null;
}

export function classifyField(field: FormField): FieldIntent {
  const label = norm(cleanLabel(field.label));

  if (field.kind === "file") {
    return FILE_RULES.find((r) => r.test.test(label))?.intent ?? "other_file";
  }

  for (const rule of PERSON_ONLY) {
    if (rule.test.test(label)) return rule.intent;
  }

  // A cover letter asked as text, not as a file.
  if ((field.kind === "textarea" || field.kind === "text") && /cover ?letter|lettre (de )?(motivation|presentation)/.test(label)) {
    return "cover_letter_text";
  }

  // A long free-text question is a written answer even when it mentions a fact word ("Tell us about a project
  // from school" is not the "school" field).
  const longQuestion = wordCount(label) >= 7 && OPEN_CUE.test(label);
  if (field.kind === "textarea" || (longQuestion && field.kind === "text")) {
    if (!longQuestion) {
      const fact = FACT_RULES.find((r) => r.test.test(label));
      if (fact && wordCount(label) <= 5) return fact.intent;
    }
    return "open_question";
  }

  if (SKILL_QUESTION.test(label) && (hasYesNoOptions(field) || field.kind === "checkbox")) {
    return "skill_yes_no";
  }

  const fact = FACT_RULES.find((r) => r.test.test(label));
  // "Will your internship count for credits at your school?" mentions a school but asks yes or no.
  if (fact && VALUE_INTENTS.has(fact.intent) && hasYesNoOptions(field)) return "unknown";
  if (fact?.intent === "address") return subFieldIntent(field) ?? "address";
  if (fact) return fact.intent;
  const sub = field.kind === "text" ? subFieldIntent(field) : null;
  if (sub) return sub;

  // A dropdown or radio group is never a written answer, however long its question is.
  if (longQuestion && !CHOICE_KINDS.has(field.kind)) return "open_question";
  return "unknown";
}

const QUESTION_RULES: Array<{ type: QuestionType; test: RegExp }> = [
  {
    type: "why_fit",
    test: /good fit|great fit|strong fit|right fit|best fit|why should we (hire|choose|pick)|what makes you (a |the )?(good|great|strong|right|ideal|qualified)|what (would|will|can) you bring|qualif|pourquoi devrions.nous|en quoi (votre|ton) profil|ce que vous apporte|why are you (a|the) (good|great|right|strong)/,
  },
  {
    type: "why_role",
    test: /why (this|the|our) (role|position|internship|job|stage|team)|interest(ed|s)? (you )?(in|about) (this|the) (role|position|internship)|what interests you about (this|the) (role|position|internship)|pourquoi ce (poste|stage|role)|attire.* (ce poste|ce stage)/,
  },
  {
    type: "why_company",
    test: /why (do you want to|would you like to|are you interested in|are you applying to|do you wish to) (work|join|intern|apply)|why (us|our company|join)|what (interests|excites|attracts|draws) you (to|about) (us|our|the company|working|joining)|why .*(company|organization|organisation|team)|pourquoi (souhaitez|voulez|aimeriez|desirez).*(joindre|travailler|rejoindre|postuler)|pourquoi (nous|notre)|qu'est.ce qui (vous|t') (attire|interesse|motive)/,
  },
  {
    type: "about_you",
    test: /tell (us|me) (a (little|bit) )?about (yourself|you)|introduce yourself|describe yourself|parlez.nous de vous|presentez.vous|parle.nous de toi|who are you|about yourself/,
  },
  { type: "weakness", test: /weakness|faiblesse|areas? (of|for|to) (improve|growth|development)|point a ameliorer/ },
  { type: "strengths", test: /strength|point fort|forces?\b|best quality/ },
  { type: "teamwork", test: /team|equipe|collaborat|conflict|disagree|coworker|colleague/ },
  { type: "challenge", test: /challenge|difficult|obstacle|defi|failure|mistake|echec|problem you (solved|faced)|overcame/ },
  { type: "career_goal", test: /goal|objecti|five years|5 years|career|aspiration|ambition|see yourself|long.term/ },
  { type: "project", test: /project|projet|something you (built|made|created)|proud|realisation/ },
  {
    type: "technical",
    test: /technical|technolog|experience (with|in|using)|stack|framework|programming|coding|language(s)? (you|of choice)|debug|architecture|system design|database|api\b|explain how/,
  },
];

export function questionTypeOf(label: string): QuestionType {
  const l = norm(cleanLabel(label));
  return QUESTION_RULES.find((r) => r.test.test(l))?.type ?? "generic";
}

/** Intents that are never filled automatically, whatever data exists. */
export const PERSON_ONLY_INTENTS: ReadonlySet<FieldIntent> = new Set<FieldIntent>([
  "work_authorization",
  "sponsorship",
  "legal_declaration",
  "consent",
  "sensitive",
  "demographic",
  "salary",
  "previous_employment",
  "referral",
]);
