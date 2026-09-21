import { listAnswers, listProjects } from "../../lib/queries";

export default async function AnswersPage() {
  const [answers, projects] = await Promise.all([listAnswers(), listProjects()]);
  const blank = answers.filter((a) => !a.answer_en).length;

  return (
    <>
      <h1>Answer bank</h1>
      <p className="lede">
        {answers.length} answers, {blank} still empty. Green is pasted as is, yellow can be
        reworded for a posting, red I always type myself.
      </p>

      {answers.length === 0 ? (
        <p className="empty">Nothing seeded yet. Run npx tsx seed/answers.ts.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>Category</th>
              <th>English</th>
              <th>French</th>
            </tr>
          </thead>
          <tbody>
            {answers.map((a) => (
              <tr key={a.id}>
                <td>{a.key}</td>
                <td>
                  <span className={`badge ${a.category}`}>{a.category}</span>
                </td>
                <td>{a.answer_en ?? <span className="empty">to write</span>}</td>
                <td>{a.answer_fr ?? <span className="empty">to write</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Projects</h2>
      {projects.length === 0 ? (
        <p className="empty">Nothing seeded yet. Run npx tsx seed/projects.ts.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Summary</th>
              <th>Tech</th>
              <th>Highlight for</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>{p.url ? <a href={p.url}>{p.name}</a> : p.name}</td>
                <td>{p.summary || <span className="empty">to write</span>}</td>
                <td>{p.tech.length ? p.tech.join(", ") : <span className="empty">to write</span>}</td>
                <td>{p.highlight_for?.join(", ") ?? "\u2014"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
