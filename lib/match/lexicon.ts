// The knowledge the CV match runs on, as data: which technologies stand in for each other, which practices a
// posting can ask for, what kind of role a title is, and what a cybersecurity role looks like. Nothing here
// touches the network or the database; lib/match/analyze.ts does the scoring.
//
// Text is compared after norm(): lowercase, accents removed, punctuation turned into spaces ("Full-Stack" →
// "full stack", "CI/CD" → "ci cd"), so every pattern below is written for that form.

import { norm } from "../apply/text";

// ---------------------------------------------------------------------------
// Technologies that stand in for each other
// ---------------------------------------------------------------------------

/**
 * Knowing one member is worth `transfer` of knowing another: a posting that asks for Vue is partly answered by React,
 * a MySQL one by PostgreSQL. The strongest family that holds both technologies decides.
 */
export const FAMILIES: Array<{ transfer: number; members: string[] }> = [
  { transfer: 0.9, members: ["JavaScript", "TypeScript"] },
  { transfer: 0.7, members: ["React", "Next.js"] },
  { transfer: 0.5, members: ["React", "Vue", "Angular", "Svelte", "Next.js"] },
  { transfer: 0.45, members: ["React", "React Native"] },
  { transfer: 0.7, members: ["Node.js", "Express", "NestJS"] },
  { transfer: 0.35, members: ["Node.js", "Express", "NestJS", "Django", "Flask", "FastAPI", "Spring", "Rails", "Laravel", "Symfony", ".NET"] },
  { transfer: 0.6, members: ["Java", "C#", "Kotlin"] },
  { transfer: 0.5, members: ["Spring", ".NET"] },
  { transfer: 0.35, members: ["Java", "C#", "Kotlin", "Scala", "Go", "Rust", "C++", "Swift", "Python", "Ruby", "PHP", "TypeScript"] },
  { transfer: 0.6, members: ["C", "C++"] },
  { transfer: 0.4, members: ["C++", "C#", "Rust", "C"] },
  { transfer: 0.9, members: ["SQL", "PostgreSQL", "MySQL", "SQL Server", "Oracle", "PL/SQL", "MariaDB", "SQLite"] },
  { transfer: 0.7, members: ["PostgreSQL", "MySQL", "SQL Server", "Oracle", "PL/SQL", "MariaDB", "SQLite"] },
  { transfer: 0.35, members: ["MongoDB", "Redis", "DynamoDB", "Cassandra", "Elasticsearch", "Firebase"] },
  { transfer: 0.55, members: ["AWS", "Azure", "GCP"] },
  { transfer: 0.35, members: ["Cloudflare", "AWS", "Azure", "GCP", "Vercel", "Heroku", "Firebase", "Supabase"] },
  { transfer: 0.4, members: ["Docker", "Kubernetes"] },
  { transfer: 0.6, members: ["GitHub Actions", "GitLab", "Jenkins", "CI/CD"] },
  { transfer: 0.85, members: ["Git", "GitHub", "GitLab", "Bitbucket"] },
  { transfer: 0.45, members: ["Jest", "Vitest", "JUnit", "pytest"] },
  { transfer: 0.6, members: ["Cypress", "Playwright", "Selenium"] },
  { transfer: 0.5, members: ["PyTorch", "TensorFlow", "scikit-learn"] },
  { transfer: 0.4, members: ["Pandas", "NumPy", "Jupyter", "scikit-learn"] },
  { transfer: 0.4, members: ["Unity", "Unreal", "Godot"] },
  { transfer: 0.4, members: ["Kotlin", "Android"] },
  { transfer: 0.4, members: ["Swift", "iOS", "SwiftUI", "Objective-C"] },
  { transfer: 0.5, members: ["REST", "GraphQL", "gRPC", "OpenAPI"] },
  { transfer: 0.45, members: ["Prometheus", "Grafana", "Datadog", "Splunk"] },
  { transfer: 0.5, members: ["RabbitMQ", "Kafka"] },
  { transfer: 0.3, members: ["Linux", "Bash", "PowerShell"] },
  { transfer: 0.9, members: ["Claude API", "OpenAI API", "LLM"] },
  { transfer: 0.5, members: ["Claude API", "OpenAI API", "LangChain", "RAG"] },
  { transfer: 0.5, members: ["HTML", "CSS", "Sass", "Tailwind"] },
];

// ---------------------------------------------------------------------------
// Practices and domains a posting can ask for
// ---------------------------------------------------------------------------

export type Concept = { id: string; fr: string; pattern: RegExp; soft?: boolean };

export const CONCEPTS: Concept[] = [
  { id: "backend", fr: "Développement back-end", pattern: /\b(back ?end|server side|cote serveur|restful|api rest)\b/ },
  { id: "frontend", fr: "Développement front-end et interfaces", pattern: /\b(front ?end|user interfaces?|interfaces? (utilisateur|web)|ui ux|ux ui|responsive)\b/ },
  { id: "fullstack", fr: "Développement full-stack", pattern: /\bfull ?stack\b/ },
  { id: "web", fr: "Applications web", pattern: /\b(web (application|app|development|platform|site)s?|applications? web|developpement web|sites? web)\b/ },
  { id: "api", fr: "API et intégrations", pattern: /\b(apis?|integrations?|web services?|services web)\b/ },
  { id: "database", fr: "Bases de données", pattern: /\b(databases?|data ?base|bases? de donnees|data model\w*|modelisation)\b/ },
  { id: "auth", fr: "Authentification et sécurité applicative", pattern: /\b(authentication|authentification|authorization|autorisation|access control|controle d acces)\b/ },
  { id: "oop", fr: "Programmation orientée objet", pattern: /\b(object oriented|orientee? objet|oop|poo)\b/ },
  { id: "testing", fr: "Tests logiciels", pattern: /\b(unit tests?|tests? unitaires?|integration tests?|tests? d integration|test driven|tdd|testing|automated tests?|tests? automatises?)\b/ },
  { id: "agile", fr: "Méthodes agiles", pattern: /\b(agile|scrum|kanban|sprints?)\b/ },
  { id: "vcs", fr: "Gestion de versions et revue de code", pattern: /\b(git|version control|gestion de versions?|controle de versions?|code reviews?|revues? de code|pull requests?)\b/ },
  { id: "cicd", fr: "Intégration et livraison continues", pattern: /\b(ci ?cd|continuous (integration|delivery|deployment)|integration continue|pipelines? de deploiement)\b/ },
  { id: "cloud", fr: "Infonuagique et déploiement", pattern: /\b(cloud|infonuagique|nuage|deploy(ment|ing|ed)?|deploiement|serverless)\b/ },
  { id: "microservices", fr: "Architecture distribuée", pattern: /\b(micro ?services?|distributed systems?|systemes distribues|event driven)\b/ },
  { id: "algorithms", fr: "Algorithmes et structures de données", pattern: /\b(algorithms?|algorithmes?|data structures?|structures? de donnees)\b/ },
  { id: "debugging", fr: "Débogage et résolution de problèmes", pattern: /\b(debug\w*|troubleshoot\w*|depannage|problem solving|resolution de problemes|root cause)\b/ },
  { id: "automation", fr: "Automatisation", pattern: /\b(automation|automatisation|automate\w*|automatiser|scripting)\b/ },
  { id: "ai", fr: "IA et modèles de langage", pattern: /\b(llms?|generative ai|ia generative|machine learning|apprentissage (automatique|machine)|deep learning|ai agents?|agents? ia|nlp|artificial intelligence|intelligence artificielle|prompt engineering)\b/ },
  { id: "saas", fr: "Produits SaaS", pattern: /\b(saas|software as a service)\b/ },
  { id: "data", fr: "Analyse et traitement de données", pattern: /\b(data (analysis|analytics|pipelines?|processing|engineering)|analyse de donnees|traitement de donnees|etl|reporting)\b/ },
  { id: "mobile", fr: "Développement mobile", pattern: /\b(mobile (apps?|applications?|development)|applications? mobiles?)\b/ },
  { id: "game", fr: "Jeu vidéo", pattern: /\b(game (development|engine|design)|jeux? video|gameplay|moteur de jeu)\b/ },
  { id: "devops", fr: "DevOps et infrastructure", pattern: /\b(devops|infrastructure as code|sre|monitoring|observabilite|observability)\b/ },
  { id: "performance", fr: "Performance et passage à l'échelle", pattern: /\b(performance (optimi[sz]ation|tuning)|optimisation|scalab\w+|latency|latence)\b/ },
  { id: "docs", fr: "Documentation technique", pattern: /\b(documentation|technical writing|redaction technique)\b/ },
  { id: "hardware", fr: "Systèmes embarqués et matériel", pattern: /\b(embedded|firmware|hardware|materiel|systemes embarques|microcontroll\w+)\b/ },
  // Soft skills count for less: nearly every posting names them.
  { id: "teamwork", fr: "Travail d'équipe", pattern: /\b(team ?work|collaborat\w+|travail d equipe|equipe)\b/, soft: true },
  { id: "communication", fr: "Communication", pattern: /\b(communication|communicat\w+ (skills|orale|ecrite))\b/, soft: true },
  { id: "autonomy", fr: "Autonomie et initiative", pattern: /\b(autonom\w+|self ?starter|initiative|independen\w+)\b/, soft: true },
  { id: "learning", fr: "Curiosité et apprentissage rapide", pattern: /\b(fast learner|quick learner|willing to learn|apprentissage rapide|curious\w*|curiosite|passion\w*)\b/, soft: true },
];

export function conceptsIn(text: string): Set<string> {
  const t = norm(text);
  return new Set(CONCEPTS.filter((c) => c.pattern.test(t)).map((c) => c.id));
}

// ---------------------------------------------------------------------------
// What kind of role is this?
// ---------------------------------------------------------------------------

export type RoleBucket =
  | "cybersecurity"
  | "off-target"
  | "software"
  | "developer"
  | "ai-developer"
  | "cloud-devops"
  | "mobile-game"
  | "qa-automation"
  | "data-engineer"
  | "qa"
  | "data-science"
  | "tech-analyst"
  | "data-analyst"
  | "research"
  | "it-general"
  | "unclear";

export type RoleFit = { bucket: RoleBucket; score: number; label: string };

const CYBER_TITLE =
  /\b(cyber\w*|infosec|pentest\w*|penetration test\w*|soc analyst|appsec|siem|vulnerabilit\w+|threat (intel\w*|hunt\w*|detection)|incident response|red team|blue team|ethical hack\w*|security (analyst|engineer|operations|architect|consultant|specialist|researcher|officer|office|intern|risk|governance)|securite (informatique|de l information|applicative|des (donnees|systemes|reseaux))|analyste (en )?securite|bureau de la securite)\b/;

const CYBER_BODY =
  /\b(cyber\w*|penetration test\w*|pentest\w*|vulnerabilit\w+|siem|soc|threat\w*|menaces?|malware|forensic\w*|firewalls?|zero trust|incident response|reponse aux incidents|iam|nist|iso 27001|owasp|securite (informatique|de l information|applicative))\b/g;

/**
 * A cybersecurity role, which is never wanted: named in the title, or a "security" title whose description is about
 * security work, or a description that is mostly about it. A software role at a security company ("video
 * surveillance software") is not one: its title is a software title and the description barely mentions any of it.
 */
export function isCybersecurityRole(title: string, description: string | null): boolean {
  const t = norm(title);
  if (CYBER_TITLE.test(t)) return true;
  const hits = (norm(description ?? "").match(CYBER_BODY) ?? []).length;
  if (/\b(security|securite)\b/.test(t) && hits >= 2) return true;
  return hits >= 8;
}

const DEV_STRONG =
  /\b(full ?stack|back ?end|front ?end|software (developer|engineer|engineering|development|dev)|web (developer|development)|application (developer|development)|developpeu(r|se) (logiciel|web|full|back|front|d applications?|java|net|python|c)\b|developpement (logiciel|web|d applications?)|programm(er|eur|euse|ation)|analyste programmeu(r|se)|ingenieur(e)? (logiciel|en developpement)|logiciels?)\b/;

const AI_DEV = /\b(ai|ia|ml|machine learning|llm|intelligence artificielle|apprentissage)\b/;
const DEV_WORD = /\b(developer|developpeu(r|se)|engineer|ingenieur(e)?|programm\w+)\b/;
/** "Développement" as a noun in a title ("Technologies numériques – Développement"); "business development" is caught as off target first. */
const DEVELOPMENT = /\b(developpement|development)\b/;
const CLOUD_DEVOPS = /\b(devops|cloud|infonuagique|platform|plateforme|sre|site reliability|infrastructure)\b/;
const QA_AUTOMATION = /\b(test automation|automatisation des tests|sdet|qa automation|automated testing)\b/;
const QA_MANUAL = /\b(quality assurance|assurance qualite|qa|quality analyst|analyste qualite|tester)\b/;
const MOBILE_GAME = /\b(mobile|android|ios|game|jeu|jeux|gameplay|jouabilite|unity|unreal|xr|extended reality|realite etendue|vr)\b/;
const DATA_ENGINEER = /\b(data engineer\w*|ingenieur(e)? (de )?donnees|etl|pipelines? de donnees)\b/;
const DATA_SCIENCE = /\b(data scien\w+|scientifique de donnees)\b/;
const DATA_ANALYST = /\b((data )?analy(st|ste|tics|se)( de donnees)?|donnees et analytique|business intelligence|bi)\b/;
const TECH_ANALYST =
  /\b(analyste (fonctionnel|d affaires|systemes?|ti|erp|assurance)|business analyst|functional analyst|systems? analyst|it (technical )?advisor|conseiller(e)? (ti|technique)|technical advisor|erp|consultant\w*|support|helpdesk|technicien\w*|administrat\w+|sap|hyperion|epm|power platform)\b/;
const RESEARCH = /\b(research|researcher|recherche|chercheur|scientist)\b/;
/** A general IT role whose title names no kind of work: "génie informatique", "Secteur TI". */
const IT_GENERAL = /\b(informatique|computer (engineering|science)|information technolog\w+|technologies? (de l information|numeriques?)|ti|it)\b/;

/** Disciplines that are not software at all: an internship there is off target whatever else the posting says. */
const OFF_TARGET =
  /\b(mechanical|mecanique|electrical|electrique|electronic\w*|civil|chemical|chimique|industrial|industrialisation|aerospace|aerospatial\w*|aircraft|avion|hydromechanic\w*|hydraulic\w*|hydraulique|structur(e|al|es)|thermal|thermique|manufactur\w+|fabrication|maintenance|engine|moteurs?|propulsion|turbine|welding|soudure|instructional|pedagogi\w+|learning design|tax|fiscal\w*|comptab\w+|accounting|auditor|audit|finance\w*|financier|marketing|human resources|ressources humaines|rh|hr|recruit\w+|legal|juridique|supply chain|logisti\w+|procurement|achats?|sales|ventes?|customer (service|success)|service (a la )?client\w*|communications?|graphic design|graphiste|product manag\w+|gestion de produits?|project (manager|management|coordinat\w+)|gestion de projets?|business development|construction|chantier|estimat\w+|architecte|architecture (du batiment)|gis|geomatique|environment\w*|conception (mecanique|electrique)|controle (des|de) (moteurs?|systemes de commande)|systemes? de commande|robotique|robotics|non cpa|cpa|flight|vol|essais? de (vol|developpement)|ecojet|challenger|aeronaut\w+|aeronef|tooling|outillage|coordinat\w+|scheduling|planificat\w+|electromec\w+|electro ?mecani\w+)\b/;

const label: Record<RoleBucket, string> = {
  cybersecurity: "Cybersécurité (exclue)",
  "off-target": "Poste hors développement logiciel",
  software: "Développement logiciel",
  developer: "Développeur (poste technique général)",
  "ai-developer": "Développement IA / apprentissage automatique",
  "cloud-devops": "Infonuagique / DevOps / infrastructure",
  "mobile-game": "Mobile ou jeu vidéo",
  "qa-automation": "Automatisation des tests",
  "data-engineer": "Ingénierie de données",
  qa: "Assurance qualité",
  "data-science": "Science des données",
  "tech-analyst": "Analyse TI / consultation",
  "data-analyst": "Analyse de données",
  research: "Recherche",
  "it-general": "Technologies de l'information (poste général)",
  unclear: "Type de poste peu clair",
};

const DEV_EVIDENCE = /\b(code|coding|develop\w*|programm\w+|software|logiciel|api|backend|frontend|debug\w*|deploy\w*|developp\w+|programmation|repository|git)\b/g;

/** How much of the description is about writing software: 0 to 1, or null when there is no description to read. */
function devEvidence(description: string | null): number | null {
  const d = norm(description ?? "");
  if (d.length < 150) return null;
  const hits = (d.match(DEV_EVIDENCE) ?? []).length;
  return Math.min(1, hits / 12);
}

/**
 * The kind of role, from its title first and its description where the title leaves it open. `score` is how well that
 * kind fits someone looking for a software developer internship (a Full-Stack / Back-End profile).
 */
export function classifyRole(title: string, description: string | null): RoleFit {
  const t = norm(title);
  const make = (bucket: RoleBucket, score: number): RoleFit => ({ bucket, score, label: label[bucket] });

  if (isCybersecurityRole(title, description)) return make("cybersecurity", 0);
  if (DEV_STRONG.test(t)) return make("software", 1);
  if (AI_DEV.test(t) && (DEV_WORD.test(t) || DEVELOPMENT.test(t))) return make("ai-developer", 0.75);
  if (QA_AUTOMATION.test(t)) return make("qa-automation", 0.7);
  if (MOBILE_GAME.test(t) && DEV_WORD.test(t)) return make("mobile-game", 0.75);
  if (CLOUD_DEVOPS.test(t) && (DEV_WORD.test(t) || /\bdevops\b/.test(t))) return make("cloud-devops", 0.7);
  if (DATA_ENGINEER.test(t)) return make("data-engineer", 0.6);
  // A title that names another discipline is off target, ahead of the looser "developer" and analyst readings.
  if (OFF_TARGET.test(t)) return make("off-target", 0);
  if (DATA_SCIENCE.test(t)) return make("data-science", 0.4);
  if (QA_MANUAL.test(t)) return make("qa", 0.4);
  if (DEV_WORD.test(t) || DEVELOPMENT.test(t)) {
    // "Developer", "engineer" or "Technologies numériques – Développement": the description says whether it is software.
    const ev = devEvidence(description);
    return make("developer", ev === null ? 0.65 : 0.4 + 0.5 * ev);
  }
  if (TECH_ANALYST.test(t)) return make("tech-analyst", 0.3);
  if (DATA_ANALYST.test(t)) return make("data-analyst", 0.3);
  if (RESEARCH.test(t)) return make("research", 0.3);
  const ev = devEvidence(description);
  if (IT_GENERAL.test(t)) return make("it-general", ev === null ? 0.45 : 0.3 + 0.4 * ev);
  return make("unclear", ev === null ? 0.35 : 0.2 + 0.4 * ev);
}

// ---------------------------------------------------------------------------
// Who may apply
// ---------------------------------------------------------------------------

// "La maîtrise de l'anglais" is mastery of English, not a master's degree: the French word only counts as a degree
// when a field, a doctorate or "studies" follows it ("maîtrise en informatique", "études de maîtrise").
const GRADUATE =
  /\b((?<!scrum )master'?s|masters|master of|master degree|phd|ph d|doctorat|doctorate|doctoral|graduate (student|program|studies|degree)|mba|maitrise (en|es|ou|professionnelle|recherche)|etudes de maitrise|programme de maitrise|a la maitrise)\b/;
const UNIVERSITY =
  /\b(bachelor'?s?|baccalaureat|undergraduate|university (student|program|degree|studies)|universite|universitaire|etudiant(e)?s? universitaires?|etudes universitaires|licence)\b/;
const COLLEGE = /\b(college|cegep|dec|diplome d etudes collegiales|technical (school|diploma)|ecole technique|attestation d etudes collegiales|aec)\b/;

export type EducationNeed = "graduate" | "university" | null;

/**
 * The level of study a posting asks for, when it asks for one this candidate (a college / DEC student) does not have:
 * a master's or doctorate, or university enrolment with no mention of college. Null when nothing is asked or a
 * college student is welcome.
 */
export function educationNeed(title: string, description: string | null): EducationNeed {
  const t = norm(`${title}\n${description ?? ""}`);
  if (GRADUATE.test(t)) return "graduate";
  if (UNIVERSITY.test(t) && !COLLEGE.test(t)) return "university";
  return null;
}
