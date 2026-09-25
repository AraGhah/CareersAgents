import Link from "next/link";

const STEPS = [
  { id: "offers", href: "/", label: "Offres" },
  { id: "track", href: "/board", label: "Suivre" },
  { id: "prepare", href: "/pipeline", label: "Préparer" },
  { id: "send", href: "/followups", label: "Envoyer" },
] as const;

export type FlowStepId = (typeof STEPS)[number]["id"];

/** Shared product path: Offres → Suivre → Préparer → Envoyer. */
export function FlowStrip({ current }: { current: FlowStepId }) {
  const currentIndex = STEPS.findIndex((s) => s.id === current);

  return (
    <nav className="flow-strip" aria-label="Parcours de candidature">
      <ol className="flow-strip-list">
        {STEPS.map((step, i) => {
          const state =
            i < currentIndex ? "done" : i === currentIndex ? "current" : "todo";
          return (
            <li key={step.id} className={`flow-strip-item is-${state}`}>
              {state === "current" ? (
                <span aria-current="step">{step.label}</span>
              ) : (
                <Link href={step.href}>{step.label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
