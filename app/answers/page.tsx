import { listAnswers, listProjects } from "../../lib/queries";
import { DbUnavailable, EmptyState, ExtLink, PageHeader, Section, Stat, TableWrap } from "../components/ui";

export const metadata = { title: "Banque de réponses" };

const CATEGORY_LABEL: Record<string, string> = {
  green: "coller tel quel",
  yellow: "reformuler",
  red: "à écrire",
};

export default async function AnswersPage() {
  let answers, projects;
  try {
    [answers, projects] = await Promise.all([listAnswers(), listProjects()]);
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

      <div className="stats">
        <Stat value={answers.length} label="Réponses au total" />
        <Stat value={written} label="Prêtes à l'emploi" tone={written > 0 ? "good" : undefined} />
        <Stat value={blank} label="Encore vides" tone={blank > 0 ? "alert" : undefined} />
        <Stat value={projects.length} label="Projets référencés" />
      </div>

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
