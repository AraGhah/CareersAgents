import skillsFile from "../skills.json";

export type ResumeLanguage = "en" | "fr";

export type ProfileEducation = {
  school: string;
  program: string | null;
  years: string | null;
};

export type ProfileExperience = {
  title: string;
  organization: string | null;
  years: string | null;
  bullets: string[];
};

export type ProfileProject = {
  name: string;
  tech: string[];
  summary: string | null;
};

export type ResumeProfile = {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  summary: string | null;
  skills: string[];
  languages: string[];
  education: ProfileEducation[];
  experience: ProfileExperience[];
  projects: ProfileProject[];
  targetRoles: string[];
  estimatedYearsExperience: number;
  analyzedAt: string;
  sourceLanguage: ResumeLanguage;
};

export type ResumeRow = {
  id: string;
  language: ResumeLanguage;
  label: string;
  filename: string;
  storage_path: string;
  mime_type: string;
  byte_size: number;
  is_active: boolean;
  uploaded_at: Date;
  analyzed_at: Date | null;
  raw_text: string | null;
  profile_json: ResumeProfile | null;
  analysis_error: string | null;
};

type DictionaryEntry = { name: string; patterns: string[] };

const dictionary = (skillsFile.dictionary as DictionaryEntry[]).map((entry) => ({
  name: entry.name,
  regexes: entry.patterns.map((pattern) => new RegExp(pattern, "i")),
}));

export const skillDictionaryNames = dictionary.map((d) => d.name);

export function extractSkillsFromText(text: string): string[] {
  const found: string[] = [];
  for (const entry of dictionary) {
    if (entry.regexes.some((re) => re.test(text))) {
      found.push(entry.name);
    }
  }
  return found;
}

export function fallbackHaveSkills(): string[] {
  return [...(skillsFile.have as string[])];
}

export function emptyProfile(lang: ResumeLanguage): ResumeProfile {
  return {
    fullName: null,
    email: null,
    phone: null,
    location: null,
    summary: null,
    skills: [],
    languages: [],
    education: [],
    experience: [],
    projects: [],
    targetRoles: ["Full-Stack Developer Intern", "Software Developer Intern"],
    estimatedYearsExperience: 0,
    analyzedAt: new Date().toISOString(),
    sourceLanguage: lang,
  };
}
