// What the CV says, as something a posting can be matched against: each technology with how well it is known
// (used in a project, listed with a level such as "Python (beginner)", or just listed), and the practices the
// CV describes (backend work, authentication, teamwork...). Built from the active CVs' text and analysed
// profiles; nothing is invented, and a technology the CV never names is never credited.

import { fallbackHaveSkills, skillDictionary, type ResumeProfile } from "../profile";
import { norm } from "../apply/text";
import { conceptsIn } from "./lexicon";

export type CvSkill = {
  name: string;
  /** 1 = used in a project or job, 0.9 intermediate, 0.8 listed, 0.55 beginner, 0.4 learning. */
  credit: number;
  /** Shown to the person: where the CV shows it. */
  evidence: string;
};

export type CvProfile = {
  skills: Map<string, CvSkill>;
  concepts: Set<string>;
  /** False when there was no CV text to read (the fallback list of skills stands in). */
  fromText: boolean;
};

export type CvSource = { raw_text: string | null; profile_json: ResumeProfile | null };

const LISTED = 0.8;

/** "(intermediate)", "(beginner)", "(learning)" written after a technology in the skills list. */
function levelCredit(word: string): { credit: number; label: string } | null {
  const w = norm(word);
  if (/\b(expert|advanced|avance|senior)\b/.test(w)) return { credit: 1, label: "avancé" };
  if (/\b(intermediate|intermediaire)\b/.test(w)) return { credit: 0.9, label: "intermédiaire" };
  if (/\b(beginner|debutant|basic|basique|novice)\b/.test(w)) return { credit: 0.55, label: "débutant" };
  if (/\b(learning|apprentissage|in progress|en cours|studying)\b/.test(w)) return { credit: 0.4, label: "en apprentissage" };
  return null;
}

/** Fallback when no CV has been read: the short list of what the candidate has (skills.json). */
export function cvFromSkillNames(names: string[]): CvProfile {
  const skills = new Map<string, CvSkill>();
  for (const name of names) skills.set(name, { name, credit: LISTED, evidence: "dans ta liste de compétences" });
  return { skills, concepts: new Set(), fromText: false };
}

export function buildCvProfile(sources: CvSource[]): CvProfile {
  const usable = sources.filter((s) => (s.raw_text?.length ?? 0) > 100 || s.profile_json);
  if (usable.length === 0) return cvFromSkillNames(fallbackHaveSkills());

  const concepts = new Set<string>();
  // How each technology is shown, across every CV: used in a project or job (the strongest evidence a CV can give),
  // listed with the level the CV states, or just listed. A stated level is authoritative over a plain listing:
  // "Python (beginner)" is not "Python" listed twice.
  const proven = new Map<string, string>();
  const levelled = new Map<string, { credit: number; label: string }>();
  const listed = new Set<string>();

  for (const { raw_text, profile_json } of usable) {
    const text = raw_text ?? "";

    for (const entry of skillDictionary) {
      for (const re of entry.regexes) {
        const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
        for (const m of text.matchAll(global)) {
          listed.add(entry.name);
          const end = (m.index ?? 0) + m[0].length;
          const after = text.slice(end, end + 30).match(/^\s*\(([^)]{2,24})\)/);
          const level = after ? levelCredit(after[1]) : null;
          const known = levelled.get(entry.name);
          if (level && (!known || level.credit > known.credit)) levelled.set(entry.name, level);
        }
      }
    }
    for (const name of profile_json?.skills ?? []) listed.add(name);

    for (const project of profile_json?.projects ?? []) {
      const blob = `${project.tech.join(" ")} ${project.summary ?? ""}`;
      for (const entry of skillDictionary) {
        if (entry.regexes.some((re) => re.test(blob)) && !proven.has(entry.name)) {
          proven.set(entry.name, `utilisé dans le projet ${project.name.split(":")[0].trim()}`);
        }
      }
    }
    for (const job of profile_json?.experience ?? []) {
      const blob = job.bullets.join(" ");
      for (const entry of skillDictionary) {
        if (entry.regexes.some((re) => re.test(blob)) && !proven.has(entry.name)) proven.set(entry.name, `utilisé chez ${job.organization ?? job.title}`);
      }
    }

    for (const id of conceptsIn(`${text}\n${profile_json?.summary ?? ""}`)) concepts.add(id);
  }

  const skills = new Map<string, CvSkill>();
  for (const name of new Set([...listed, ...proven.keys()])) {
    const used = proven.get(name);
    const level = levelled.get(name);
    if (used) skills.set(name, { name, credit: 1, evidence: used });
    else if (level) skills.set(name, { name, credit: level.credit, evidence: `dans ta liste de compétences (${level.label})` });
    else skills.set(name, { name, credit: LISTED, evidence: "dans ta liste de compétences" });
  }

  return { skills, concepts, fromText: true };
}
