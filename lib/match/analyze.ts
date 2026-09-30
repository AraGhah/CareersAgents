// Compares a posting with the CV and says, criterion by criterion, why the number is what it is.
//
//   skills    the technologies the posting names, each weighted by how much it asks for it (required, a
//             responsibility, a nice-to-have), against what the CV shows: used in a project, listed with a level, or
//             a related technology that partly stands in (Vue asked, React known).
//   concepts  the practices and domains it names (testing, agile, authentication, cloud...) against the CV's own text.
//   role      what kind of role the title is, and how close that is to a software developer internship.
//   level     an internship or a senior role, and the level of study it asks for.
//   timing, location, language   as before, with the reason for each.
//
// Deterministic: the same posting and CV give the same numbers, every run. What the posting does not say is neutral
// (0.5), never a guess in either direction, so a posting with no text cannot score high on the strength of a title.

import { skillDictionary } from "../profile";
import { norm } from "../apply/text";
import { buildCvProfile, type CvProfile } from "./cv";
import { CONCEPTS, FAMILIES, classifyRole, educationNeed, isCybersecurityRole } from "./lexicon";
import {
  COMPONENT_NAMES,
  type Band,
  type ComponentName,
  type Components,
  type Confidence,
  type Criterion,
  type MatchReport,
  type MatchedSkill,
  type MissingSkill,
  type RelatedSkill,
  type ScoreInput,
  type Section,
  type Weights,
} from "./types";

const NEUTRAL = 0.5;

const SECTION_WEIGHT: Record<Section, number> = { title: 1.2, required: 1, responsibility: 0.8, mentioned: 0.7, nice: 0.35, about: 0.4 };
const SECTION_FR: Record<Section, string> = {
  title: "dans le titre",
  required: "exigé",
  responsibility: "dans les responsabilités",
  mentioned: "mentionné",
  nice: "un atout",
  about: "dans la présentation",
};

// ---------------------------------------------------------------------------
// Where in the posting something is said
// ---------------------------------------------------------------------------

const HEADERS: Array<{ section: Section; re: RegExp }> = [
  {
    section: "nice",
    re: /nice[- ]to[- ]haves?|bonus points?|preferred (?:qualifications|skills)|\bassets?\s*:|un atout|un plus|serait un atout|constitue un atout/i,
  },
  {
    section: "required",
    re: /requirements?\b|required (?:skills|qualifications|experience)|qualifications?\b|must[- ]haves?|what you(?:'|’)?ll bring|what you bring|what we(?:'|’)?re looking for|who you are|your profile|minimum qualifications|exigences|profil recherch[ée]|comp[ée]tences requises|qualit[ée]s requises|vous poss[ée]dez|ce que vous apportez|votre profil|ce que nous recherchons/i,
  },
  {
    section: "responsibility",
    re: /responsibilities|what you(?:'|’)?ll do|what you will do|\bduties\b|day[- ]to[- ]day|\bmandat\b|responsabilit[ée]s|\bt[aâ]ches\b|vos fonctions|ce que vous ferez|principales fonctions|description du poste/i,
  },
  {
    section: "about",
    re: /\bbenefits\b|\bperks\b|what we offer|why join|about us|who we are|our culture|equal opportunity|avantages|ce que nous offrons|[àa] propos de nous|pourquoi joindre|how to apply|comment postuler/i,
  },
];

/** A section runs from its heading to the next one, but not for ever: a mention far below any heading is just a mention. */
const SECTION_REACH = 2500;

type Header = { pos: number; section: Section };

function headersOf(text: string): Header[] {
  const out: Header[] = [];
  for (const { section, re } of HEADERS) {
    for (const m of text.matchAll(new RegExp(re.source, "gi"))) out.push({ pos: m.index ?? 0, section });
  }
  return out.sort((a, b) => a.pos - b.pos);
}

function sectionAt(headers: Header[], pos: number): Section {
  let found: Header | null = null;
  for (const h of headers) {
    if (h.pos <= pos) found = h;
    else break;
  }
  return found && pos - found.pos <= SECTION_REACH ? found.section : "mentioned";
}

// Inline modifiers that belong to one mention: "Kafka is a plus", "familiarity with Docker". A heading such as
// "Nice to have:" is not one: it opens the next section, and the section logic handles it.
const NICE_AFTER = /^[^.;:\n]{0,30}?\b(?:(?:is|are|would be|serait|seraient)\s+(?:a\s+plus|an\s+asset|un\s+atout|un\s+plus|preferred)|un\s+atout|un\s+plus|constitue(?:nt)?\s+un\s+atout|appr[eé]ci[eé]e?s?|preferred)\b/i;
const FAMILIAR_BEFORE = /(?:familiarity with|exposure to|basic knowledge of|notions? (?:de|of)|connaissances? de base (?:de|en|des?))[^.;:\n]{0,30}$/i;

function mentionWeight(text: string, start: number, end: number, section: Section): number {
  if (NICE_AFTER.test(text.slice(end, end + 60))) return Math.min(SECTION_WEIGHT.nice, SECTION_WEIGHT[section]);
  if (FAMILIAR_BEFORE.test(text.slice(Math.max(0, start - 50), start))) return Math.min(0.6, SECTION_WEIGHT[section]);
  return SECTION_WEIGHT[section];
}

type Need = { name: string; weight: number; section: Section; mentions: number };

/** How much the text asks for something matched by these patterns, or null when it never names it. */
function need(text: string, titleLength: number, headers: Header[], name: string, regexes: RegExp[], soft = false): Need | null {
  let best = 0;
  let section: Section = "mentioned";
  let mentions = 0;
  for (const re of regexes) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))) {
      const pos = m.index ?? 0;
      mentions += 1;
      const inTitle = pos < titleLength;
      const sec: Section = inTitle ? "title" : sectionAt(headers, pos);
      const w = inTitle ? SECTION_WEIGHT.title : mentionWeight(text, pos, pos + m[0].length, sec);
      if (w > best) {
        best = w;
        section = sec;
      }
    }
  }
  if (mentions === 0) return null;
  const weight = Math.min(1.3, best + Math.min(0.3, 0.1 * (mentions - 1)));
  return { name, weight: soft ? weight * 0.5 : weight, section, mentions };
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

function relatedCredit(name: string, cv: CvProfile): { via: string; credit: number } | null {
  let best: { via: string; credit: number } | null = null;
  for (const family of FAMILIES) {
    if (!family.members.includes(name)) continue;
    for (const member of family.members) {
      if (member === name) continue;
      const known = cv.skills.get(member);
      if (!known) continue;
      const credit = family.transfer * known.credit;
      if (!best || credit > best.credit) best = { via: member, credit };
    }
  }
  return best;
}

function skillAssessment(scanText: string, titleLength: number, cv: CvProfile) {
  const headers = headersOf(scanText);
  const needs = skillDictionary
    .map((e) => need(scanText, titleLength, headers, e.name, e.regexes))
    .filter((n): n is Need => n !== null);

  const matched: MatchedSkill[] = [];
  const related: RelatedSkill[] = [];
  const missing: MissingSkill[] = [];
  let earned = 0;
  let asked = 0;
  for (const n of needs) {
    asked += n.weight;
    const own = cv.skills.get(n.name);
    if (own) {
      earned += n.weight * own.credit;
      matched.push({ name: n.name, credit: own.credit, section: n.section, evidence: own.evidence });
      continue;
    }
    const near = relatedCredit(n.name, cv);
    if (near) {
      earned += n.weight * near.credit;
      related.push({ name: n.name, via: near.via, credit: near.credit, section: n.section });
    } else {
      missing.push({ name: n.name, section: n.section });
    }
  }
  const byWeight = (a: { section: Section }, b: { section: Section }) => SECTION_WEIGHT[b.section] - SECTION_WEIGHT[a.section];
  matched.sort(byWeight);
  related.sort(byWeight);
  missing.sort(byWeight);
  return { known: needs.length > 0, score: smooth(earned, asked), matched, related, missing };
}

/**
 * The share earned, pulled toward neutral by one imaginary neutral observation: a single technology named in a title
 * is one data point, not proof, while a dozen named in the requirements barely move. Nothing asked is neutral.
 */
const PRIOR_WEIGHT = 1;
function smooth(earned: number, asked: number): number {
  return asked > 0 ? (earned + PRIOR_WEIGHT * NEUTRAL) / (asked + PRIOR_WEIGHT) : NEUTRAL;
}

function conceptAssessment(scanText: string, titleLength: number, cv: CvProfile) {
  const text = norm(scanText);
  // The title is normalised on its own so its length is the same in both forms.
  const normTitleLength = norm(scanText.slice(0, titleLength)).length;
  const headers = headersOf(text);
  const needs = CONCEPTS.map((c) => need(text, normTitleLength, headers, c.id, [c.pattern], c.soft)).filter((n): n is Need => n !== null);
  let earned = 0;
  let asked = 0;
  const matched: string[] = [];
  const missing: string[] = [];
  for (const n of needs) {
    asked += n.weight;
    if (cv.concepts.has(n.name)) {
      earned += n.weight;
      matched.push(n.name);
    } else {
      missing.push(n.name);
    }
  }
  return { known: needs.length > 0, score: smooth(earned, asked), matched, missing };
}

// ---------------------------------------------------------------------------
// The rest: each returns its score and the reasons
// ---------------------------------------------------------------------------

type Assessment = { score: number; notes: string[] };

const INTERN_TITLE = /\bintern(?:s|ship|ships)?\b|\bstages?\b|\bstagiaires?\b|\binternes?\b|\bco-?ops?\b|\bjunior\b|\bentry[- ]level\b/i;
const SENIOR_TITLE = /\b(?:senior|staff|principal|director|directeur|directrice|manager|gestionnaire|lead|vp|head of)\b/i;

function levelAssessment(input: ScoreInput, text: string): Assessment {
  const notes: string[] = [];
  let score: number;
  if (INTERN_TITLE.test(input.title)) {
    score = 1;
    notes.push("Titre de stage ou de niveau débutant.");
  } else if (SENIOR_TITLE.test(input.title)) {
    score = 0;
    notes.push("Titre de poste senior ou de gestion.");
  } else if ([...text.matchAll(/(\d+)\s*\+?\s*(?:years?|ans)\s+(?:of\s+)?(?:experience|exp[eé]rience)/gi)].some((m) => Number(m[1]) >= 3)) {
    score = 0;
    notes.push("Exige 3 ans d'expérience ou plus.");
  } else {
    score = 0.6;
    notes.push("Niveau non précisé.");
  }
  const study = educationNeed(input.title, input.description);
  if (study === "graduate") {
    score *= 0.15;
    notes.push("Exige des études de cycle supérieur (maîtrise ou doctorat) : tu es au DEC.");
  } else if (study === "university") {
    score *= 0.65;
    notes.push("Vise des étudiants universitaires : à vérifier si le DEC est accepté.");
  }
  return { score, notes };
}

type Season = "winter" | "summer" | "fall" | "spring";
type Term = { season: Season; year: number | null };
const SEASON_FR: Record<Season, string> = { winter: "hiver", summer: "été", fall: "automne", spring: "printemps" };

// Read on norm() text (accents removed), where "l'été" is "l'ete" and a word boundary works.
const SEASON_WORDS: Array<[Season, string]> = [
  ["winter", "winter|hiver"],
  ["summer", "summer|ete"],
  ["fall", "fall|autumn|automne"],
  ["spring", "spring|printemps"],
];
const ANY_SEASON = SEASON_WORDS.map(([, w]) => w).join("|");
const MONTH_SEASON: Record<string, Season> = {
  january: "winter", janvier: "winter", february: "winter", fevrier: "winter",
  march: "spring", mars: "spring", april: "spring", avril: "spring",
  may: "summer", mai: "summer", june: "summer", juin: "summer", july: "summer", juillet: "summer", august: "summer", aout: "summer",
  september: "fall", septembre: "fall", sept: "fall", october: "fall", octobre: "fall", november: "fall", novembre: "fall", december: "fall", decembre: "fall",
};
const ANY_MONTH = Object.keys(MONTH_SEASON).join("|");
const TERM_CUE = /\b(intern|internship|stage|stagiaire|co ?op|coop|semester|session|term|start|starts|begin|debut|commence)\b/;

function seasonOf(word: string): Season {
  return (SEASON_WORDS.find(([, w]) => new RegExp(`^(?:${w})$`).test(word)) ?? SEASON_WORDS[0])[0];
}

/**
 * The internship term(s) a posting names: a season with its year ("Winter 2027", "été 2027"), a month with its year
 * beside an internship word ("start: January 2027"), or a bare season in the title or right next to an internship
 * word. A season mentioned in passing ("a rooftop terrace open in summer and fall", "Spring Boot") is not a term.
 */
export function internshipTerms(title: string, description: string): Term[] {
  const terms: Term[] = [];
  const zones: Array<{ text: string; title: boolean }> = [
    { text: norm(title), title: true },
    { text: norm(description), title: false },
  ];
  for (const { text, title: inTitle } of zones) {
    for (const m of text.matchAll(new RegExp(`\\b(${ANY_SEASON})\\b[\\s,:-]*(?:semester|session|term|internship|stage|co ?op|coop)?[\\s,:-]*(?:of )?(20\\d\\d)\\b`, "g"))) {
      terms.push({ season: seasonOf(m[1]), year: Number(m[2]) });
    }
    for (const m of text.matchAll(new RegExp(`\\b(20\\d\\d)\\b[\\s,:-]*(${ANY_SEASON})\\b`, "g"))) {
      terms.push({ season: seasonOf(m[2]), year: Number(m[1]) });
    }
    for (const m of text.matchAll(new RegExp(`\\b(${ANY_MONTH})\\b\\.?\\s*(20(?:26|27|28))\\b`, "g"))) {
      const near = text.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + m[0].length + 40);
      if (inTitle || TERM_CUE.test(near)) terms.push({ season: MONTH_SEASON[m[1]], year: Number(m[2]) });
    }
    // A season with no year: in the title, or in the description only right beside an internship word.
    for (const m of text.matchAll(new RegExp(`\\b(${ANY_SEASON})\\b`, "g"))) {
      if (/^\s*[-,]?\s*(?:boot|framework|cloud|mvc|security|data|batch|integration)\b/.test(text.slice((m.index ?? 0) + m[0].length))) continue;
      const near = text.slice(Math.max(0, (m.index ?? 0) - 30), (m.index ?? 0) + m[0].length + 30);
      if (inTitle || TERM_CUE.test(near)) terms.push({ season: seasonOf(m[1]), year: null });
    }
  }
  return terms;
}

function timingAssessment(input: ScoreInput, description: string): Assessment {
  const all = internshipTerms(input.title, description);
  // A season with its year is authoritative: a bare "winter" beside "session" must not overrule "Winter 2026".
  const dated = all.filter((t) => t.year !== null);
  const terms = dated.length > 0 ? dated : all;
  const label = (t: Term) => `${SEASON_FR[t.season]}${t.year ? ` ${t.year}` : ""}`;
  const fits = terms.filter((t) => t.season === "winter" && (t.year === null || t.year === 2027));
  if (fits.length > 0) return { score: 1, notes: [`Session visée : ${label(fits[0])}.`] };
  if (terms.length > 0) {
    const seen = [...new Set(terms.map(label))].join(", ");
    const pastWinter = terms.some((t) => t.season === "winter" && t.year !== null && t.year < 2027);
    return { score: 0, notes: [pastWinter ? `Session d'hiver déjà passée (${seen}).` : `Session ${seen} : pas ta période (hiver 2027).`] };
  }
  if (INTERN_TITLE.test(input.title)) return { score: 0.7, notes: ["Aucune session nommée : stage à confirmer pour l'hiver 2027."] };
  return { score: NEUTRAL, notes: ["Période non précisée."] };
}

const LOCAL = /montr[eé]al|laval|saint-?laurent|st[ .\-]?laurent|vaudreuil/i;
const SUBURB = /longueuil|brossard|boucherville|terrebonne|repentigny|dorval|pointe-claire|kirkland|dollard|lachine|verdun|westmount|mont-royal|saint-lambert|saint-hubert|varennes|blainville|mirabel|anjou|lasalle/i;
const ELSEWHERE = /toronto|vancouver|calgary|ottawa|mississauga|waterloo|edmonton|winnipeg|quebec city|ville de qu[eé]bec|halifax|victoria|saskatoon|regina|kitchener|hamilton/i;
const US = /\bunited states\b|\busa\b|\bu\.s\.a?\b|new york|san francisco|seattle|austin|boston|chicago|denver|los angeles/i;
const REMOTE = /\bremote\b|t[eé]l[eé]travail|\bwfh\b|work from home/i;

function locationAssessment(input: ScoreInput, text: string): Assessment {
  const place = input.location ?? "";
  const remote = input.workplaceType === "remote" || REMOTE.test(text);
  const canada = /canada|qu[eé]bec|ontario/i.test(text);
  const localOf = (s: string) => LOCAL.test(s) || (input.companyCity != null && LOCAL.test(input.companyCity) && !s);

  // The posting's own place decides when it gives one; the description may mention other offices.
  if (place) {
    if (LOCAL.test(place)) return { score: 1, notes: [`${place.split(",")[0]} : ta région.`] };
    if (SUBURB.test(place)) return { score: 0.9, notes: [`${place.split(",")[0]} : dans la grande région de Montréal.`] };
    if (remote && !(US.test(place) && !canada)) return { score: 1, notes: ["Télétravail."] };
    if (ELSEWHERE.test(place) || US.test(place)) return { score: 0, notes: [`${place.split(",")[0]} : hors de ta zone (Montréal ou télétravail).`] };
    if (/qu[eé]bec|\bqc\b/i.test(place)) return { score: 0.4, notes: [`${place.split(",")[0]} : au Québec mais hors de la région de Montréal.`] };
  }
  if (localOf(place) || LOCAL.test(text)) return { score: 1, notes: ["Montréal mentionné dans l'offre."] };
  if (remote && !US.test(text)) return { score: 1, notes: ["Télétravail."] };
  if (remote && US.test(text) && canada) return { score: 1, notes: ["Télétravail au Canada."] };
  if (ELSEWHERE.test(text) || US.test(text)) return { score: 0, notes: ["Lieu hors de ta zone (Montréal ou télétravail)."] };
  return { score: NEUTRAL, notes: ["Lieu non précisé."] };
}

const OTHER_LANGUAGE =
  /\b(?:spanish|espagnol|german|allemand|mandarin|chinese|chinois|japanese|japonais|arabic|arabe|italian|italien|portuguese|portugais|dutch|n[eé]erlandais|russian|russe|korean|cor[eé]en|hindi|cantonese|cantonais)\b/gi;

function languageAssessment(text: string): Assessment {
  let match: RegExpExecArray | null;
  while ((match = OTHER_LANGUAGE.exec(text)) !== null) {
    const window = text.slice(Math.max(0, match.index - 48), match.index + match[0].length + 48);
    if (/\b(?:required|obligatoire|must|mandatory|fluent|courant|native|langue maternelle)\b/i.test(window)) {
      return { score: 0, notes: [`Exige une autre langue (${match[0].toLowerCase()}).`] };
    }
  }
  if (/\b(?:bilingual|bilingue)\b/i.test(text)) return { score: 1, notes: ["Bilingue français-anglais demandé : c'est ton cas."] };
  return { score: 1, notes: ["Aucune langue étrangère exigée."] };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const LABEL: Record<ComponentName, string> = {
  skills: "Compétences techniques",
  concepts: "Domaines et pratiques",
  role: "Adéquation du poste",
  level: "Niveau et admissibilité",
  timing: "Période",
  location: "Lieu",
  language: "Langues",
};

export function bandOf(percent: number, gated: boolean): Band {
  if (gated) return "skip";
  if (percent >= 85) return "high";
  if (percent >= 70) return "mid";
  if (percent >= 60) return "ok";
  return "low";
}

const conceptFr = (id: string) => CONCEPTS.find((c) => c.id === id)?.fr ?? id;
const pct = (n: number) => `${Math.round(n * 100)} %`;

export function analyzePosting(input: ScoreInput, cv: CvProfile, weights: Weights): MatchReport {
  const description = input.description ?? "";
  const hasDescription = description.trim().length >= 150;
  const scanText = `${input.title}\n${description}`;
  const fullText = [input.title, input.location, input.workplaceType, input.companyCity, description].filter(Boolean).join("\n");

  const skills = skillAssessment(scanText, input.title.length, cv);
  const concepts = conceptAssessment(scanText, input.title.length, cv);
  const role = classifyRole(input.title, input.description);
  const level = levelAssessment(input, fullText);
  const timing = timingAssessment(input, description);
  const location = locationAssessment(input, fullText);
  const language = languageAssessment(fullText);
  const cyber = isCybersecurityRole(input.title, input.description);

  const components: Components = {
    skills: skills.score,
    concepts: concepts.score,
    role: role.score,
    level: level.score,
    timing: timing.score,
    location: location.score,
    language: language.score,
  };

  let total = 0;
  for (const name of COMPONENT_NAMES) total += components[name] * weights[name];
  const percentPrecise = Math.round(total * 1000) / 10;
  const percent = Math.round(total * 100);

  const gateReasons: string[] = [];
  if (components.location === 0) gateReasons.push("le lieu ne convient pas");
  if (components.timing === 0) gateReasons.push("la période ne convient pas");
  if (components.role === 0) gateReasons.push(cyber ? "c'est un poste en cybersécurité (exclu)" : "ce n'est pas un poste de développement logiciel");
  const gated = gateReasons.length > 0;

  const confidence: Confidence = !hasDescription ? "low" : skills.known && skills.matched.length + skills.related.length + skills.missing.length >= 3 && description.length >= 400 ? "high" : "medium";

  const notes: string[] = [];
  if (!hasDescription) notes.push("Pas de description : les compétences et les pratiques restent neutres (50 %) tant que le texte de l'offre n'est pas connu.");
  for (const n of level.notes) if (/Exige|Vise/.test(n)) notes.push(n);
  if (role.bucket === "research") notes.push("Poste de recherche : souvent réservé aux cycles supérieurs.");

  const skillCount = skills.matched.length + skills.related.length + skills.missing.length;
  const skillLine = (s: { name: string; section: Section }, mark: string, tail: string) => `${mark} ${s.name} (${SECTION_FR[s.section]}) ${tail}`.trim();
  const skillDetails = [
    ...skills.matched.slice(0, 8).map((s) => skillLine(s, "✓", `— ${s.evidence}`)),
    ...skills.related.slice(0, 5).map((s) => skillLine(s, "≈", `— proche de ${s.via} (${pct(s.credit)} de crédit)`)),
    ...skills.missing.slice(0, 8).map((s) => skillLine(s, "✗", "— absent de ton CV")),
  ];

  const criteria: Criterion[] = COMPONENT_NAMES.map((id): Criterion => {
    const base = { id, label: LABEL[id], score: components[id], weight: weights[id] };
    switch (id) {
      case "skills":
        return {
          ...base,
          verdict: skills.known
            ? `${skillCount} technologie${skillCount > 1 ? "s" : ""} nommée${skillCount > 1 ? "s" : ""} : ${skills.matched.length} dans ton CV, ${skills.related.length} apparentée${skills.related.length > 1 ? "s" : ""}, ${skills.missing.length} absente${skills.missing.length > 1 ? "s" : ""}.`
            : hasDescription
              ? "Aucune technologie connue n'est nommée : composante neutre (50 %)."
              : "Pas de description : composante neutre (50 %).",
          details: skillDetails,
        };
      case "concepts":
        return {
          ...base,
          verdict: concepts.known
            ? `${concepts.matched.length} pratique${concepts.matched.length > 1 ? "s" : ""} sur ${concepts.matched.length + concepts.missing.length} se retrouvent dans ton CV.`
            : "Aucune pratique reconnue dans l'offre : composante neutre (50 %).",
          details: [...concepts.matched.slice(0, 8).map((c) => `✓ ${conceptFr(c)}`), ...concepts.missing.slice(0, 8).map((c) => `✗ ${conceptFr(c)} — non décrit dans ton CV`)],
        };
      case "role":
        return {
          ...base,
          verdict: `${role.label}${role.score === 0 ? " : écarté." : "."}`,
          details: cyber ? ["Les postes en cybersécurité sont exclus de ta recherche."] : [],
        };
      case "level":
        return { ...base, verdict: level.notes[0], details: level.notes.slice(1) };
      case "timing":
        return { ...base, verdict: timing.notes[0], details: [] };
      case "location":
        return { ...base, verdict: location.notes[0], details: [] };
      case "language":
        return { ...base, verdict: language.notes[0], details: [] };
    }
  });

  return {
    percent,
    percentPrecise,
    gated,
    gateReasons,
    band: bandOf(percent, gated),
    confidence,
    criteria,
    skills: { matched: skills.matched, related: skills.related, missing: skills.missing },
    concepts: { matched: concepts.matched.map(conceptFr), missing: concepts.missing.map(conceptFr) },
    role: { bucket: role.bucket, label: role.label, score: role.score },
    cybersecurity: cyber,
    hasDescription,
    notes,
  };
}

export { buildCvProfile };
