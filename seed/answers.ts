// The answer bank. Written by hand, on purpose. Run with: npx tsx seed/answers.ts
//
// green  = pasted verbatim, never touched by a model
// yellow = a model may reword it for a specific posting, I read the result
// red    = never auto-filled, never guessed, I type it myself every time
//
// Facts below come from my public portfolio (aragahramanyan.dev) and from the
// dates I already set for this search. Rerunning is safe: a null in this file
// does not wipe a value that is already in the database.

import { pool } from "../lib/db";
import type { AnswerCategory } from "../lib/types";

type SeedAnswer = {
  key: string;
  category: AnswerCategory;
  answer_en?: string;
  answer_fr?: string;
};

const answers: SeedAnswer[] = [
  {
    key: "full_name",
    category: "green",
    answer_en: "Ara Ghahramanyan",
    answer_fr: "Ara Ghahramanyan",
  },
  {
    key: "email",
    category: "green",
    answer_en: "ara.ghahramanyan07@gmail.com",
    answer_fr: "ara.ghahramanyan07@gmail.com",
  },
  {
    key: "phone",
    category: "green",
    answer_en: "438-993-6997",
    answer_fr: "438-993-6997",
  },
  {
    key: "city",
    category: "green",
    answer_en: "Montr\u00e9al, Qu\u00e9bec",
    answer_fr: "Montr\u00e9al, Qu\u00e9bec",
  },
  {
    key: "links",
    category: "green",
    answer_en:
      "Portfolio: https://aragahramanyan.dev  GitHub: https://github.com/AraGhah  LinkedIn: https://linkedin.com/in/ara-ghahramanyan",
    answer_fr:
      "Portfolio : https://aragahramanyan.dev  GitHub : https://github.com/AraGhah  LinkedIn : https://linkedin.com/in/ara-ghahramanyan",
  },
  {
    key: "school_program",
    category: "green",
    answer_en:
      "Third-year Computer Science Technology (DEC) at Coll\u00e8ge de Bois-de-Boulogne, 2024 to now.",
    answer_fr:
      "Troisi\u00e8me ann\u00e9e en Techniques de l\u2019informatique (DEC) au Coll\u00e8ge de Bois-de-Boulogne, 2024 \u00e0 aujourd\u2019hui.",
  },
  {
    key: "graduation_date",
    category: "green",
    answer_en: "June 2027",
    answer_fr: "Juin 2027",
  },
  {
    key: "available_from",
    category: "green",
    answer_en: "January 2027",
    answer_fr: "Janvier 2027",
  },
  {
    key: "location_rule",
    category: "green",
    answer_en: "Montr\u00e9al or Laval on-site or hybrid; fully remote elsewhere in Canada",
    answer_fr:
      "Montr\u00e9al ou Laval, sur place ou hybride; enti\u00e8rement \u00e0 distance ailleurs au Canada",
  },
  {
    key: "languages",
    category: "green",
    answer_en: "English and French, written and spoken.",
    answer_fr: "Anglais et fran\u00e7ais, \u00e0 l\u2019\u00e9crit et \u00e0 l\u2019oral.",
  },

  {
    key: "why_backend",
    category: "yellow",
    answer_en:
      "I mainly work on backend and full-stack systems: REST APIs, authentication, databases, and cloud infrastructure. What I like is making the path from a request to a stored result explicit, so a bug is a wrong state I can trace, not a mystery in the UI.",
    answer_fr:
      "Je travaille surtout sur des syst\u00e8mes backend et full stack : API REST, authentification, bases de donn\u00e9es et infrastructure infonuagique. Ce que j\u2019aime, c\u2019est rendre explicite le chemin d\u2019une requ\u00eate jusqu\u2019\u00e0 un \u00e9tat stock\u00e9, pour qu\u2019un bogue soit un \u00e9tat faux que je peux retracer, pas un myst\u00e8re dans l\u2019interface.",
  },
  {
    key: "why_this_company",
    category: "yellow",
    answer_en:
      "I am looking for a Winter 2027 software internship in Montr\u00e9al in backend, cloud, or full stack. I will rewrite this for each posting using a fact I wrote down with its source URL. Do not send the generic sentence as-is.",
    answer_fr:
      "Je cherche un stage d\u2019hiver 2027 \u00e0 Montr\u00e9al en backend, infonuagique ou full stack. Je r\u00e9\u00e9cris cette r\u00e9ponse pour chaque offre avec un fait que j\u2019ai not\u00e9 et son URL source. Ne pas envoyer la phrase g\u00e9n\u00e9rique telle quelle.",
  },
  {
    key: "biggest_project",
    category: "yellow",
    answer_en:
      "Dossier is a research and personalization pipeline I designed and built: prospects in, researched and scored, personalized email variants out, with retries and dead-letter handling in PostgreSQL. A 100-prospect pilot reached about a 9.6% reply rate. Trade Catch and SentinelOps are the other two I would put next to it, depending on the role.",
    answer_fr:
      "Dossier est un pipeline de recherche et de personnalisation que j\u2019ai con\u00e7u et construit : prospects en entr\u00e9e, recherche et notation, variantes de courriel en sortie, avec nouvelles tentatives et lettres mortes dans PostgreSQL. Un pilote de 100 prospects a atteint environ 9,6 % de r\u00e9ponses. Trade Catch et SentinelOps sont les deux autres que je mettrais \u00e0 c\u00f4t\u00e9, selon le poste.",
  },
  {
    key: "strengths",
    category: "yellow",
    answer_en:
      "I write systems so a failure is visible. On Dossier I added scoring, retries and dead-letter tracking so weak research stopped hiding behind a green checkmark. On Trade Catch I kept messaging separate from billing and booking rules, because copy can vary and those decisions cannot.",
    answer_fr:
      "Je construis des syst\u00e8mes pour qu\u2019un \u00e9chec soit visible. Sur Dossier j\u2019ai ajout\u00e9 la notation, les nouvelles tentatives et le suivi des lettres mortes pour qu\u2019une recherche faible cesse de se cacher derri\u00e8re une coche verte. Sur Trade Catch j\u2019ai s\u00e9par\u00e9 la messagerie des r\u00e8gles de facturation et de r\u00e9servation : le texte peut varier, ces d\u00e9cisions non.",
  },
  {
    key: "weakness",
    category: "yellow",
    answer_en:
      "I tend to keep building the tool instead of sending the application. The Winter 2027 search is the case in point: the tracker has to stay behind the applications, not the other way around.",
    answer_fr:
      "J\u2019ai tendance \u00e0 continuer \u00e0 construire l\u2019outil au lieu d\u2019envoyer la candidature. La recherche d\u2019hiver 2027 en est l\u2019exemple : le suivi doit rester derri\u00e8re les candidatures, pas l\u2019inverse.",
  },
  {
    key: "teamwork_example",
    category: "yellow",
    answer_en:
      "On Travel Express I owned the Node.js backend, JWT auth, and the API contract while others built the React front. Most of the friction was two people assuming different shapes for the same response. We fixed it by writing the routes down first and integrating through Git instead of discovering the mismatch at the last minute.",
    answer_fr:
      "Sur Travel Express je m\u2019occupais du backend Node.js, de l\u2019auth JWT et du contrat d\u2019API pendant que d\u2019autres construisaient le front React. La plupart des accrocs venaient de deux personnes qui supposaient des formes diff\u00e9rentes pour la m\u00eame r\u00e9ponse. On l\u2019a r\u00e9gl\u00e9 en \u00e9crivant les routes d\u2019abord et en int\u00e9grant par Git, au lieu de d\u00e9couvrir l\u2019\u00e9cart \u00e0 la fin.",
  },
  {
    key: "career_goal",
    category: "yellow",
    answer_en:
      "I want a Winter 2027 internship on a team that ships backend or cloud work I can trace end to end, then keep going toward that kind of role after I graduate in June 2027.",
    answer_fr:
      "Je veux un stage d\u2019hiver 2027 dans une \u00e9quipe qui livre du backend ou de l\u2019infonuagique que je peux suivre de bout en bout, puis continuer dans ce genre de r\u00f4le apr\u00e8s le dipl\u00f4me de juin 2027.",
  },

  { key: "work_authorization", category: "red" },
  { key: "salary_expectation", category: "red" },
  { key: "criminal_record_check", category: "red" },
  { key: "security_clearance", category: "red" },
  { key: "self_identification", category: "red" },
];

async function main() {
  for (const a of answers) {
    await pool.query(
      `INSERT INTO answers (key, category, answer_en, answer_fr)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE
          SET category   = EXCLUDED.category,
              answer_en  = COALESCE(EXCLUDED.answer_en, answers.answer_en),
              answer_fr  = COALESCE(EXCLUDED.answer_fr, answers.answer_fr),
              updated_at = now()`,
      [a.key, a.category, a.answer_en ?? null, a.answer_fr ?? null],
    );
  }

  const { rows } = await pool.query<{ key: string; category: string }>(
    `SELECT key, category FROM answers WHERE answer_en IS NULL ORDER BY category, key`,
  );

  console.log(`${answers.length} answers in the bank.`);
  if (rows.length) {
    console.log(`\n${rows.length} still have no English text:`);
    for (const r of rows) console.log(`  [${r.category}] ${r.key}`);
  }

  const { rows: missingFr } = await pool.query<{ key: string }>(
    `SELECT key FROM answers
      WHERE category IN ('green','yellow') AND answer_en IS NOT NULL AND answer_fr IS NULL
      ORDER BY key`,
  );
  if (missingFr.length) {
    console.log(`\n${missingFr.length} green/yellow answers have no French version:`);
    for (const r of missingFr) console.log(`  ${r.key}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
