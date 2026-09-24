import type { ResumeProfile } from "../../lib/profile";

export function ResumeProfilePreview({ profile }: { profile: ResumeProfile }) {
  return (
    <div className="stack" style={{ gap: "var(--s-5)" }}>
      {profile.summary ? <p className="lede">{profile.summary}</p> : null}

      {profile.skills.length > 0 ? (
        <div>
          <div className="panel-title" style={{ marginBottom: "var(--s-2)" }}>
            Compétences
          </div>
          <p className="tag-list" style={{ margin: 0 }}>
            {profile.skills.map((s) => (
              <span key={s} className="badge neutral">
                {s}
              </span>
            ))}
          </p>
        </div>
      ) : null}

      {profile.languages.length > 0 ? (
        <div>
          <div className="panel-title" style={{ marginBottom: "var(--s-2)" }}>
            Langues
          </div>
          <p className="tag-list" style={{ margin: 0 }}>
            {profile.languages.map((l) => (
              <span key={l} className="badge neutral">
                {l}
              </span>
            ))}
          </p>
        </div>
      ) : null}

      {profile.experience.length > 0 ? (
        <div>
          <div className="panel-title" style={{ marginBottom: "var(--s-3)" }}>
            Expérience
          </div>
          <div className="stack" style={{ gap: "var(--s-3)" }}>
            {profile.experience.map((exp, i) => (
              <div key={i}>
                <div className="cell-main">
                  {exp.title}
                  {exp.organization ? ` · ${exp.organization}` : ""}
                </div>
                {exp.years ? <div className="cell-sub">{exp.years}</div> : null}
                {exp.bullets.length > 0 ? (
                  <ul className="small muted" style={{ margin: "var(--s-1) 0 0", paddingLeft: "1.1rem" }}>
                    {exp.bullets.map((b, bi) => (
                      <li key={bi}>{b}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {profile.projects.length > 0 ? (
        <div>
          <div className="panel-title" style={{ marginBottom: "var(--s-3)" }}>
            Projets
          </div>
          <div className="stack" style={{ gap: "var(--s-3)" }}>
            {profile.projects.map((p, i) => (
              <div key={i}>
                <div className="cell-main">{p.name}</div>
                {p.tech.length > 0 ? <div className="cell-sub mono">{p.tech.join(", ")}</div> : null}
                {p.summary ? <div className="small muted">{p.summary}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {profile.education.length > 0 ? (
        <div>
          <div className="panel-title" style={{ marginBottom: "var(--s-3)" }}>
            Formation
          </div>
          <div className="stack" style={{ gap: "var(--s-2)" }}>
            {profile.education.map((e, i) => (
              <div key={i}>
                <div className="cell-main">{e.school}</div>
                <div className="cell-sub">
                  {[e.program, e.years].filter(Boolean).join(" · ")}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
