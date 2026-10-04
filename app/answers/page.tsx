import { listAnswerMemory, type MemoryRow } from "../../lib/apply/memory-store";
import { listAnswers, listProjects } from "../../lib/queries";
import { forgetMemoryAction, setAnswerAutoUseAction, updateMemoryAction } from "../answers-actions";
import { Flash, SubmitButton } from "../components/client-ui";
import { DbUnavailable, EmptyState, ExtLink, PageHeader, Section, Stat, TableWrap } from "../components/ui";

export const metadata = { title: "Banque de réponses" };

// Reads the database: render per request, never freeze it at build time.
export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<string, string> = {
  green: "coller tel quel",
  yellow: "reformuler",
  red: "à écrire",
};

const AUTO_USE: Array<{ key: string; label: string }> = [
  { key: "work_authorization", label: "Autorisation de travailler au Canada" },
  { key: "sponsorship_required", label: "Besoin d'un parrainage (visa)" },
  { key: "salary_expectation", label: "Attentes salariales (champ texte)" },
];

const OK_MESSAGE: Record<string, string> = {
  "auto-on": "Réponse confirmée : elle sera remplie automatiquement sur les formulaires.",
  "auto-off": "Réponse remise en attente : chaque formulaire te la redemandera.",
  memory: "Réponse retenue mise à jour.",
  forgotten: "Réponse oubliée : le prochain formulaire te la redemandera.",
};

export default async function AnswersPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  let answers, projects, memory: MemoryRow[];
  try {
    [answers, projects, memory] = await Promise.all([listAnswers(), listProjects(), listAnswerMemory()]);
  } catch (err) {
    return (
      <>
        <PageHeader title="Banque de réponses" />
        <DbUnavailable detail={(err as Error).message} />
      </>
    );
  }
  const blank = answers.filter((a) => !a.answer_en).length;
  const written = answers.length - blank;

  return (
    <>
      <PageHeader
        title="Banque de réponses"
        lede="En vert, à coller tel quel. En jaune, à adapter à l'offre. En rouge, à écrire toi-même."
      />

      {sp.ok && OK_MESSAGE[sp.ok] ? <Flash>{OK_MESSAGE[sp.ok]}</Flash> : null}
      {sp.error === "schema" ? <Flash tone="error">Applique schema-v16.sql d&apos;abord (voir le README).</Flash> : null}

      <div className="stats">
        <Stat value={answers.length} label="Réponses au total" />
        <Stat value={written} label="Prêtes à l'emploi" tone={written > 0 ? "good" : undefined} />
        <Stat value={blank} label="Encore vides" tone={blank > 0 ? "alert" : undefined} />
        <Stat value={projects.length} label="Projets référencés" />
      </div>

      <Section title="Utilisées automatiquement" id="auto">
        <p className="section-note">
          Confirme une fois ta réponse : les formulaires qui posent la question pour le Canada (ou le pays où tu vis)
          la reçoivent sans clic. Les autres questions personnelles et d&apos;auto-identification attendent toujours.
        </p>
        <TableWrap>
          <table>
            <caption className="visually-hidden">Réponses légales confirmées pour un usage automatique</caption>
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col">Ta réponse</th>
                <th scope="col">Automatique</th>
              </tr>
            </thead>
            <tbody>
              {AUTO_USE.map(({ key, label }) => {
                const a = answers.find((x) => x.key === key);
                const written = a?.answer_en ?? a?.answer_fr ?? null;
                return (
                  <tr key={key}>
                    <td data-label="Question" className="cell-main">{label}</td>
                    <td data-label="Ta réponse">{written ?? <span className="empty">à écrire d&apos;abord</span>}</td>
                    <td data-label="Automatique">
                      {written ? (
                        <form action={setAnswerAutoUseAction} className="form-actions">
                          <input type="hidden" name="key" value={key} />
                          <input type="hidden" name="on" value={a?.auto_use ? "0" : "1"} />
                          <span className={`badge ${a?.auto_use ? "green" : "yellow"}`}>{a?.auto_use ? "oui" : "non"}</span>
                          <SubmitButton className="small" pendingLabel="…">
                            {a?.auto_use ? "Redemander à chaque fois" : "Confirmer et utiliser"}
                          </SubmitButton>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Section>

      <Section title="Réponses retenues des formulaires" id="memoire">
        <p className="section-note">
          Une question que le bureau ne savait pas remplir et à laquelle tu as répondu sur un formulaire est retenue :
          le prochain formulaire qui la pose reçoit la même réponse.
        </p>
        {memory.length === 0 ? (
          <EmptyState title="Rien de retenu pour l'instant">
            Les réponses que tu valides dans le panneau « Formulaire en ligne » d&apos;une candidature apparaîtront ici.
          </EmptyState>
        ) : (
          <TableWrap>
            <table>
              <caption className="visually-hidden">Réponses retenues et réutilisées</caption>
              <thead>
                <tr>
                  <th scope="col">Question</th>
                  <th scope="col">Réponse</th>
                  <th scope="col">Réutilisée</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {memory.map((m) => (
                  <tr key={m.key}>
                    <td data-label="Question" className="cell-main">{m.question}</td>
                    <td data-label="Réponse">
                      <form action={updateMemoryAction} className="form-actions">
                        <input type="hidden" name="key" value={m.key} />
                        <input name="value" defaultValue={m.value} aria-label={`Réponse à « ${m.question} »`} />
                        <SubmitButton className="small" pendingLabel="…">Enregistrer</SubmitButton>
                      </form>
                    </td>
                    <td data-label="Réutilisée" className="muted">{m.uses} fois</td>
                    <td>
                      <form action={forgetMemoryAction}>
                        <input type="hidden" name="key" value={m.key} />
                        <SubmitButton className="small" pendingLabel="…">Oublier</SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <Section title="Réponses" id="reponses">
        {answers.length === 0 ? (
          <EmptyState title="Aucune réponse enregistrée">
            Lance <code>npx tsx seed/answers.ts</code> pour importer la banque de départ.
          </EmptyState>
        ) : (
          <TableWrap>
            <table>
              <caption className="visually-hidden">Réponses types classées par catégorie et langue</caption>
              <thead>
                <tr>
                  <th scope="col">Clé</th>
                  <th scope="col">Catégorie</th>
                  <th scope="col">Anglais</th>
                  <th scope="col">Français</th>
                </tr>
              </thead>
              <tbody>
                {answers.map((a) => (
                  <tr key={a.id}>
                    <td data-label="Clé" className="cell-main mono">
                      {a.key}
                    </td>
                    <td data-label="Catégorie">
                      <span className={`badge ${a.category}`}>
                        {CATEGORY_LABEL[a.category] ?? a.category}
                      </span>
                    </td>
                    <td data-label="Anglais">
                      {a.answer_en ?? <span className="empty">à écrire</span>}
                    </td>
                    <td data-label="Français">
                      {a.answer_fr ?? <span className="empty">à écrire</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <Section title="Projets" id="projets">
        {projects.length === 0 ? (
          <EmptyState title="Aucun projet enregistré">
            Lance <code>npx tsx seed/projects.ts</code> pour importer les projets de départ.
          </EmptyState>
        ) : (
          <TableWrap>
            <table>
              <caption className="visually-hidden">Projets utilisables dans les lettres de motivation</caption>
              <thead>
                <tr>
                  <th scope="col">Nom</th>
                  <th scope="col">Résumé</th>
                  <th scope="col">Techno</th>
                  <th scope="col">Utile pour</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td data-label="Nom" className="cell-main">
                      {p.url ? <ExtLink href={p.url}>{p.name}</ExtLink> : p.name}
                    </td>
                    <td data-label="Résumé">
                      {p.summary || <span className="empty">à écrire</span>}
                    </td>
                    <td data-label="Techno">
                      {p.tech.length ? (
                        <span className="tag-list">
                          {p.tech.map((t) => (
                            <span key={t} className="tag">
                              {t}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="empty">à écrire</span>
                      )}
                    </td>
                    <td data-label="Utile pour" className="muted">
                      {p.highlight_for?.join(", ") ?? "n/d"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>
    </>
  );
}
