/** Route-level skeleton: every page here waits on Postgres, so the shell
 *  stays put and only the content area shimmers. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Chargement…</span>

      <div className="page-head">
        <div className="page-head-text" style={{ width: "100%" }}>
          <div className="skel skel-line" style={{ width: "7rem", height: "0.7rem" }} />
          <div className="skel skel-title" />
          <div className="skel skel-line" style={{ width: "min(34rem, 85%)" }} />
        </div>
      </div>

      <div className="stats">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skel skel-card" />
        ))}
      </div>

      <div className="skel-rows">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="skel skel-line"
            style={{ width: `${92 - i * 9}%`, marginBottom: "0.9rem" }}
          />
        ))}
      </div>
    </div>
  );
}
