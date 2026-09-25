"use client";

import Link from "next/link";
import { startTransition, useOptimistic, useState } from "react";
import { CompanyTile } from "./company-tile";

export type KanbanCard = {
  id: string;
  title: string;
  companyName: string;
  status: string;
  meta?: string | null;
};

type Move = { id: string; status: string };

/**
 * Shared draggable Kanban used by /board and /pipeline. Drag-and-drop is
 * additive: the per-application status <Select> on the application detail
 * page remains the accessible/keyboard way to change status.
 */
export function KanbanBoard({
  cards,
  statuses,
  statusLabels,
  changeStatusAction,
}: {
  cards: KanbanCard[];
  statuses: string[];
  statusLabels: Record<string, string>;
  changeStatusAction: (form: FormData) => Promise<void>;
}) {
  const [optimisticCards, moveCard] = useOptimistic(cards, (state, move: Move) =>
    state.map((c) => (c.id === move.id ? { ...c, status: move.status } : c)),
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  function handleDrop(status: string) {
    const id = draggingId;
    setDraggingId(null);
    setDropTarget(null);
    if (!id) return;
    const card = optimisticCards.find((c) => c.id === id);
    if (!card || card.status === status) return;

    startTransition(() => {
      moveCard({ id, status });
      const form = new FormData();
      form.set("applicationId", id);
      form.set("status", status);
      void changeStatusAction(form);
    });
  }

  return (
    <div className="board">
      {statuses.map((status) => {
        const column = optimisticCards.filter((c) => c.status === status);
        return (
          <section
            key={status}
            data-status={status}
            className={`board-col${column.length === 0 ? " is-empty" : ""}${
              dropTarget === status ? " is-drop-target" : ""
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDropTarget(status);
            }}
            onDragLeave={() => setDropTarget((t) => (t === status ? null : t))}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(status);
            }}
          >
            <h3>
              {statusLabels[status] ?? status}
              <span className="count">{column.length}</span>
            </h3>
            {column.length === 0 ? (
              <p className="board-empty">Aucune</p>
            ) : (
              <ul>
                {column.map((card) => (
                  <li key={card.id}>
                    <Link
                      href={`/applications/${card.id}`}
                      className={`board-card${draggingId === card.id ? " is-dragging" : ""}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", card.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDraggingId(card.id);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDropTarget(null);
                      }}
                    >
                      {card.title}
                      <span className="co">
                        <CompanyTile name={card.companyName} size="sm" />
                        {card.companyName}
                        {card.meta ? <span className="mono">{card.meta}</span> : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
