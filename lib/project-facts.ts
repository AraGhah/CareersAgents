// Hand-written, first-person facts about each project, in both languages, for the
// cover letter's "proof" and "match" paragraphs and the email's "allowed me to" clause.
//
// Everything here restates what seed/projects.ts and seed/answers.ts already say
// (problem, what was built, tools, honest status). Do not add a claim that is not
// in one of those two files — a letter that overstates a project is worse than a
// short one. Keep this file in step with seed/projects.ts: entries are matched to
// database projects by name (case and punctuation ignored).
//
// French text avoids gendered forms of "I" on purpose (no "heureux", "inscrit"...).

import type { Project } from "./types";

type Bilingual = { en: string; fr: string };

export type ProjectFacts = {
  /**
   * What this project gave me hands-on experience with, in the order I would list it. The
   * email opens its experience sentence with these. All of them come from the project's tech
   * in seed/project-data.ts, except "APIs" for SentinelOps, which is Ara's own wording.
   */
  skills: string[];
  /** Clause after "In {name}, ": the problem or system, starting with the pronoun ("I built ..."). */
  built: Bilingual;
  /** Full sentence: the tools and the concrete technical contribution. */
  contribution: Bilingual;
  /** Full sentence(s): the honest outcome, including whether it is still in development. */
  outcome: Bilingual;
  /** Clause after "In particular, ": one specific thing I did, starting with the pronoun. */
  action: Bilingual;
  /** Follows "which has helped me develop": the skill that action built. */
  skill: Bilingual;
  /** Follows "I would bring": the strength this project supports. */
  strength: Bilingual;
  /** Email: completes "One of my main projects, {name}, allowed me to ...". */
  enabled: Bilingual;
};

const FACTS: Record<string, ProjectFacts> = {
  dossier: {
    skills: ["TypeScript", "Node.js", "Express", "PostgreSQL"],
    built: {
      en: "I designed and built a research and personalization pipeline for outbound sales that ingests prospects, researches each company, scores the research, generates email variants, and delivers only what passes quality gates",
      fr: "j’ai conçu et construit un pipeline de recherche et de personnalisation pour la vente sortante : il reçoit des prospects, recherche chaque entreprise, note la recherche, génère des variantes de courriel et ne livre que ce qui passe les contrôles de qualité",
    },
    contribution: {
      en: "I used TypeScript, Node.js and PostgreSQL to keep workflow state, with retries and dead-letter handling for steps that fail.",
      fr: "J’ai utilisé TypeScript, Node.js et PostgreSQL pour conserver l’état du flux de travail, avec des nouvelles tentatives et une gestion des lettres mortes pour les étapes en échec.",
    },
    outcome: {
      en: "A 100-prospect pilot reached about a 9.6% reply rate, and the project is live at rundossier.co.",
      fr: "Un pilote de 100 prospects a atteint environ 9,6 % de réponses, et le projet est en ligne à rundossier.co.",
    },
    action: {
      en: "I added scoring, retries and dead-letter tracking to Dossier so that weak research stopped hiding behind a green checkmark",
      fr: "j’ai ajouté la notation, les nouvelles tentatives et le suivi des lettres mortes à Dossier pour qu’une recherche faible cesse de se cacher derrière une coche verte",
    },
    skill: {
      en: "the habit of making failures visible and traceable in backend workflows",
      fr: "l’habitude de rendre les échecs visibles et traçables dans les flux de travail backend",
    },
    strength: {
      en: "a habit of building systems whose failures are visible",
      fr: "l’habitude de construire des systèmes dont les échecs sont visibles",
    },
    enabled: {
      en: "design and build a research and personalization pipeline that reached about a 9.6% reply rate in a 100-prospect pilot",
      fr: "concevoir et construire un pipeline de recherche et de personnalisation qui a atteint environ 9,6 % de réponses lors d’un pilote de 100 prospects",
    },
  },

  tradecatch: {
    skills: ["Next.js", "TypeScript", "Cloudflare Workers", "Twilio"],
    built: {
      en: "I am building a lead-recovery app for contractors that engages a missed caller, qualifies the job, alerts the contractor, and follows up on estimates until the customer answers, books, or opts out",
      fr: "je construis une application de récupération de prospects pour les entrepreneurs : elle engage la conversation avec un appelant manqué, qualifie le travail, alerte l’entrepreneur et relance les estimations jusqu’à ce que le client réponde, réserve ou se désabonne",
    },
    contribution: {
      en: "I am using Next.js, TypeScript, Cloudflare Workers and Twilio to keep messaging flexible while scheduling, pricing, and opt-out stay deterministic rules.",
      fr: "J’utilise Next.js, TypeScript, Cloudflare Workers et Twilio pour garder la messagerie flexible tandis que la planification, la tarification et le désabonnement restent des règles déterministes.",
    },
    outcome: {
      en: "The project is still in development, and it has taught me to keep behaviour that can vary separate from rules that cannot.",
      fr: "Le projet est toujours en développement, et il m’a appris à séparer ce qui peut varier des règles qui ne le peuvent pas.",
    },
    action: {
      en: "I kept messaging separate from the scheduling, pricing, and opt-out rules in TradeCatch, because copy can vary and those decisions cannot",
      fr: "j’ai séparé la messagerie des règles de planification, de tarification et de désabonnement dans TradeCatch, parce que le texte peut varier et pas ces décisions",
    },
    skill: {
      en: "skills in separating flexible behaviour from deterministic business rules",
      fr: "des compétences pour séparer le comportement flexible des règles d’affaires déterministes",
    },
    strength: {
      en: "a habit of keeping flexible behaviour separate from fixed rules",
      fr: "l’habitude de séparer le comportement flexible des règles fixes",
    },
    enabled: {
      en: "build a lead-recovery app for contractors that keeps flexible messaging separate from fixed business rules",
      fr: "construire une application de récupération de prospects pour entrepreneurs qui sépare la messagerie flexible des règles d’affaires fixes",
    },
  },

  sentinelops: {
    skills: ["AWS", "ASP.NET Core", "C#", "APIs"],
    built: {
      en: "I am building a cloud-native incident desk that ingests security events from AWS, normalizes them, and puts analysts on a ranked queue instead of a firehose",
      fr: "je construis un centre infonuagique de gestion des incidents qui ingère des événements de sécurité d’AWS, les normalise et place les analystes devant une file classée plutôt qu’un flot ininterrompu",
    },
    contribution: {
      en: "I am using ASP.NET Core, PostgreSQL and AWS to build the API, the data layer, and the event-processing workers behind that queue.",
      fr: "J’utilise ASP.NET Core, PostgreSQL et AWS pour construire l’API, la couche de données et les processus de traitement des événements derrière cette file.",
    },
    outcome: {
      en: "The project is still in development, and it is teaching me how to design event ingestion and ranking on AWS.",
      fr: "Le projet est toujours en développement, et il m’apprend à concevoir l’ingestion et le classement d’événements sur AWS.",
    },
    action: {
      en: "I have been building SentinelOps, a cloud-native incident desk on AWS with an ASP.NET Core API, PostgreSQL and Lambda workers",
      fr: "je construis SentinelOps, un centre infonuagique de gestion des incidents sur AWS, avec une API ASP.NET Core, PostgreSQL et des fonctions Lambda",
    },
    skill: {
      en: "skills in designing cloud event pipelines on AWS",
      fr: "des compétences en conception de pipelines d’événements infonuagiques sur AWS",
    },
    strength: {
      en: "a focus on surfacing what matters, not everything at once",
      fr: "le souci de faire ressortir l’essentiel plutôt que tout en même temps",
    },
    enabled: {
      en: "work with cloud infrastructure and build a more complex backend system",
      fr: "travailler avec l’infrastructure infonuagique et de construire un système backend plus complexe",
    },
  },

  travelexpress: {
    skills: ["Node.js", "Express", "JWT", "MongoDB"],
    built: {
      en: "I owned the Node.js backend of a team travel website: the REST routes, the JWT authentication, and the API contract the React front end consumed",
      fr: "j’ai pris en charge le backend Node.js d’un site de voyage réalisé en équipe : les routes REST, l’authentification JWT et le contrat d’API que le front React consommait",
    },
    contribution: {
      en: "I used Node.js, Express and JWT to expose those REST routes and secure them, with MongoDB and Oracle/PL-SQL for persistence.",
      fr: "J’ai utilisé Node.js, Express et JWT pour exposer ces routes REST et les sécuriser, avec MongoDB et Oracle/PL-SQL pour la persistance.",
    },
    outcome: {
      en: "It was an academic team project in 2026, and I learned to write the routes down first so the front and back ends agreed on every response.",
      fr: "C’était un projet académique d’équipe en 2026, et j’y ai appris à écrire les routes d’abord pour que le front et le back s’entendent sur chaque réponse.",
    },
    action: {
      en: "I owned the Node.js backend, the JWT authentication, and the API contract of Travel Express, a team travel site, while teammates built the React front end",
      fr: "j’ai pris en charge le backend Node.js, l’authentification JWT et le contrat d’API de Travel Express, un site de voyage réalisé en équipe, pendant que d’autres construisaient le front React",
    },
    skill: {
      en: "skills in designing REST APIs and agreeing on contracts with a front-end team",
      fr: "des compétences en conception d’API REST et en définition de contrats avec une équipe front-end",
    },
    strength: {
      en: "a habit of writing API contracts down before integrating",
      fr: "l’habitude de définir les contrats d’API par écrit avant d’intégrer",
    },
    enabled: {
      en: "own the Node.js backend, the JWT authentication, and the API contract of a team travel site",
      fr: "prendre en charge le backend Node.js, l’authentification JWT et le contrat d’API d’un site de voyage réalisé en équipe",
    },
  },

  // The seed does not say which parts of VAMP2 Survivors were mine, so the wording
  // stays at "worked on" until it does.
  vamp2survivors: {
    skills: ["C#", "Unity"],
    built: {
      en: "I worked on a Unity 3D survival game where enemy behaviour is a state machine plus Observer events and a decoy mechanic targets through an interface instead of a hardcoded list",
      fr: "j’ai travaillé sur un jeu de survie 3D dans Unity où le comportement des ennemis repose sur une machine à états et des événements Observer, et où un leurre cible par une interface plutôt que par une liste codée en dur",
    },
    contribution: {
      en: "I used C# and Unity in a codebase where the gameplay logic is covered by unit tests.",
      fr: "J’ai utilisé C# et Unity dans un code dont la logique de jeu est couverte par des tests unitaires.",
    },
    outcome: {
      en: "It was an academic project in 2026.",
      fr: "C’était un projet académique en 2026.",
    },
    action: {
      en: "I worked on VAMP2 Survivors, a Unity 3D survival game whose enemy behaviour is a state machine with Observer events",
      fr: "j’ai travaillé sur VAMP2 Survivors, un jeu de survie 3D dans Unity dont le comportement des ennemis repose sur une machine à états et des événements Observer",
    },
    skill: {
      en: "skills in structuring game logic with state machines and events",
      fr: "des compétences pour structurer la logique de jeu avec des machines à états et des événements",
    },
    strength: {
      en: "a habit of structuring logic so it can be unit tested",
      fr: "l’habitude de structurer la logique pour qu’elle puisse être testée unitairement",
    },
    enabled: {
      en: "work on a Unity 3D survival game with state-machine enemy behaviour and unit-tested gameplay logic",
      fr: "travailler sur un jeu de survie 3D dans Unity avec un comportement des ennemis en machine à états et une logique de jeu testée unitairement",
    },
  },
};

function key(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Hand-written facts for a project, or null when this project has none yet. */
export function projectFacts(project: Project | undefined): ProjectFacts | null {
  if (!project) return null;
  return FACTS[key(project.name)] ?? null;
}

/** Every string a project's facts can put into a letter, for the proper-noun check. */
export function projectFactsText(project: Project): string[] {
  const facts = projectFacts(project);
  if (!facts) return [];
  return Object.values(facts).flatMap((value) => (Array.isArray(value) ? value : [value.en, value.fr]));
}
