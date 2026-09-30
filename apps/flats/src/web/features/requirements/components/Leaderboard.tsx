import { type KeyboardEvent, useRef } from "react";
import { formatPoints, formatPrice } from "../../../utils/format";
import { useFlip } from "../hooks/useFlip";
import type { Row } from "../utils/rank";

const Movement = ({ row }: { row: Row }) => {
  if (row.rank === null) {
    return row.savedRank === null ? null : <span className="movement out">Out</span>;
  }
  if (row.savedRank === null) {
    return <span className="movement in">In</span>;
  }
  const moved = row.savedRank - row.rank;
  return moved === 0 ? (
    <span className="movement still">
      <span className="visually-hidden">Unchanged</span>
    </span>
  ) : (
    <span className={`movement ${moved > 0 ? "up" : "down"}`}>
      <span aria-hidden="true">{moved > 0 ? "▲" : "▼"}</span>
      <span className="visually-hidden">{moved > 0 ? "Up" : "Down"}</span>
      {Math.abs(moved)}
    </span>
  );
};

const facts = ({ property }: Row) =>
  [
    formatPrice(property.price),
    property.bedrooms === null ? null : `${property.bedrooms} bed`,
    property.sizeSqft === null ? null : `${property.sizeSqft.toLocaleString("en-GB")} sq ft`,
  ]
    .filter(Boolean)
    .join(" · ");

/** The lowest and highest scores in play, so the bars show how far apart the flats are rather than their size. */
type Span = { readonly low: number; readonly high: number };

const Verdict = ({ row, span }: { row: Row; span: Span }) => {
  if (row.draft.kind !== "scored") {
    return <span className="leader-reason">{row.draft.reason}</span>;
  }
  const share = 0.08 + 0.92 * ((row.draft.total - span.low) / (span.high - span.low || 1));
  return (
    <span className="leader-score">
      <span className="leader-total">{formatPoints(row.draft.total)}</span>
      <span className={`leader-bar ${row.draft.total < 0 ? "down" : "up"}`} style={{ inlineSize: `${share * 100}%` }} />
    </span>
  );
};

const GROUPS = [
  { key: "scored", title: null },
  { key: "excluded", title: "Ruled out by Jev" },
  { key: "limited", title: "Ruled out by a limit" },
  { key: "rejected", title: "Rejected" },
] as const;

const groupOf = (row: Row) => (row.property.status === "rejected" ? "rejected" : row.draft.kind);

/** The flats in play, best first under the draft, each showing how far the draft moves it from the saved ranking. */
export const Leaderboard = ({
  rows,
  selected,
  onSelect,
  showRejected,
}: {
  rows: readonly Row[];
  selected: string | null;
  onSelect: (propertyId: string) => void;
  showRejected: boolean;
}) => {
  const list = useRef<HTMLDivElement>(null);
  const shown = showRejected ? rows : rows.filter((row) => row.property.status !== "rejected");
  useFlip(list, shown.map((row) => row.property.id).join());
  const totals = shown.flatMap((row) => (row.draft.kind === "scored" ? [row.draft.total] : []));
  const span = { low: Math.min(...totals), high: Math.max(...totals) };

  const move = (event: KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step === undefined) {
      return;
    }
    event.preventDefault();
    const index = shown.findIndex((row) => row.property.id === selected);
    const next = shown[Math.max(0, Math.min(shown.length - 1, index + step))];
    if (next !== undefined) {
      onSelect(next.property.id);
      list.current?.querySelector<HTMLElement>(`[data-flip="${next.property.id}"] button`)?.focus();
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move between the row buttons inside
    <div className="leaderboard" ref={list} onKeyDown={move}>
      {GROUPS.map(({ key, title }) => {
        const group = shown.filter((row) => groupOf(row) === key);
        return group.length === 0 ? null : (
          <section key={key} className={`leader-group ${key}`} aria-label={title ?? "In play"}>
            {title !== null && (
              <h3 className="leader-group-title">
                {title} <span className="muted">{group.length}</span>
              </h3>
            )}
            <ol className="leader-list">
              {group.map((row) => (
                <li key={row.property.id} data-flip={row.property.id}>
                  <button
                    type="button"
                    className="leader"
                    aria-pressed={row.property.id === selected}
                    onClick={() => onSelect(row.property.id)}
                  >
                    <span className="leader-place">
                      <span className="leader-rank">{row.rank ?? "–"}</span>
                      <Movement row={row} />
                    </span>
                    {row.property.thumbnailUrl ? (
                      <img className="leader-photo" src={row.property.thumbnailUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="leader-photo" />
                    )}
                    <span className="leader-main">
                      <span className="leader-address">{row.property.address}</span>
                      <span className="leader-facts">
                        {facts(row)}
                        {row.unanswered.length > 0 && row.property.readable && (
                          <span className="leader-unread" title="Questions Jev has not answered in these words">
                            {row.unanswered.length} unread
                          </span>
                        )}
                      </span>
                    </span>
                    <Verdict row={row} span={span} />
                  </button>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
};
