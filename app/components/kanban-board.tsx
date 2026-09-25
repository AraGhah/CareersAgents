"use client";

import Link from "next/link";
import { startTransition, useOptimistic, useState } from "react";
import { CompanyTile } from "./company-tile";
import { useToast } from "./toaster";

export type KanbanCard = {
  id: string;
  title: string;
  companyName: string;
  status: string;
  meta?: string | null;
};

type Move = { id: string; status: string };

/**
 * Shared Kanban used by /board and /pipeline. Desktop: columns + drag.
 * Mobile: stacked groups (empty columns hidden). Keyboard: status <select>.
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
  const { push } = useToast();
  const [optimisticCards, moveCard] = useOptimistic(cards, (state, move: Move) =>
    state.map((c) => (c.id === move.id ? { ...c, status: move.status } : c)),
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  function applyMove(id: string, status: string) {
    const card = optimisticCards.find((c) => c.id === id);
    if (!card || card.status === status) return;
    const fromLabel = statusLabels[card.status] ?? card.status;
    const toLabel = statusLabels[status] ?? status;

    startTransition(async () => {
      moveCard({ id, status });
      const form = new FormData();
      form.set("applicationId", id);
      form.set("status", status);
      try {
        await changeStatusAction(form);
        push(`${card.title} → ${toLabel}`, "success");
      } catch {
        push(`Impossible de passer de ${fromLabel} à ${toLabel}.`, "error");
      }
    });
  }

  function handleDrop(status: string) {
    const id = draggingId;
    setDraggingId(null);
    setDropTarget(null);
    if (!id) return;
    applyMove(id, status);
  }

  function renderCard(card: KanbanCard) {
    return (
      <article className={`board-card${draggingId === card.id ? " is-dragging" : ""}`}>
        <button
          type="button"
          className="board-card-grip"
          draggable
          aria-label={`Déplacer ${card.title}`}
          title="Glisser vers une autre colonne"
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
          ⋮⋮
        </button>
        <Link href={`/applications/${card.id}`} className="board-card-link">
          {card.title}
          <span className="co">
            <CompanyTile name={card.companyName} size="sm" />
            {card.companyName}
            {card.meta ? <span className="mono">{card.meta}</span> : null}
          </span>
        </Link>
        <label className="board-card-status">
          <span className="visually-hidden">Statut de {card.title}</span>
          <select value={card.status} onChange={(e) => applyMove(card.id, e.target.value)}>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {statusLabels[s] ?? s}
              </option>
            ))}
          </select>
        </label>
      </article>
    );
  }

  return (
    <>
      <div className="board-scroller board-desktop" data-scroll-hint="">
        <div className="board" role="list" aria-label="Tableau des candidatures par statut">
          {statuses.map((status) => {
            const column = optimisticCards.filter((c) => c.status === status);
            return (
              <section
                key={status}
                data-status={status}
                role="listitem"
                aria-label={`${statusLabels[status] ?? status}, ${column.length}`}
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
                      <li key={card.id}>{renderCard(card)}</li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </div>

      <div className="board-mobile" aria-label="Candidatures groupées par statut">
        {statuses.map((status) => {
          const column = optimisticCards.filter((c) => c.status === status);
          if (column.length === 0) return null;
          return (
            <section key={status} className="board-mobile-group" data-status={status}>
              <h3>
                {statusLabels[status] ?? status}
                <span className="count">{column.length}</span>
              </h3>
              <ul>
                {column.map((card) => (
                  <li key={card.id}>{renderCard(card)}</li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
