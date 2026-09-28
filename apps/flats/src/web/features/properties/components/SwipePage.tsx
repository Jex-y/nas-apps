import { useEffect, useState } from "react";
import type { PropertySummary, UpdateStatus } from "../../../../contract";
import { useProperties, useTriage } from "../api/properties";
import { type SwipeDirection, useSwipeGesture } from "../hooks/useSwipeGesture";
import { isTyping } from "../utils/keyboard";
import { SwipeCard } from "./SwipeCard";

const DECISIONS = {
  left: { status: "rejected", reason: null },
  right: { status: "shortlisted" },
} as const satisfies Record<SwipeDirection, UpdateStatus>;

type Swipe = { property: PropertySummary; direction: SwipeDirection };

/** New listings one at a time: swipe or ←/→ to reject or shortlist, u to undo. */
export const SwipePage = () => {
  const properties = useProperties("new");
  const triage = useTriage();
  const [history, setHistory] = useState<readonly Swipe[]>([]);

  const [top, next] = properties.data ?? [];
  const gesture = useSwipeGesture((direction) => {
    if (top !== undefined) {
      setHistory((swipes) => [...swipes, { property: top, direction }]);
      triage.mutate({ property: top, update: DECISIONS[direction] });
    }
  });
  const last = history.at(-1);
  const canSwipe = top !== undefined && !gesture.busy;
  const canUndo = last !== undefined && !gesture.busy;

  const undo = () => {
    if (canUndo) {
      setHistory((swipes) => swipes.slice(0, -1));
      triage.mutate({ property: last.property, update: { status: "new" } });
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const actions: Record<string, () => void> = {
        ArrowLeft: () => canSwipe && gesture.fling("left"),
        ArrowRight: () => canSwipe && gesture.fling("right"),
        u: undo,
      };
      const action = actions[event.key];
      if (action !== undefined) {
        event.preventDefault();
        action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (properties.isPending) {
    return <p className="muted">Loading…</p>;
  }
  if (properties.error) {
    return <p className="error">{properties.error.message}</p>;
  }

  return (
    <section className="swipe">
      <div className="page-heading">
        <h1>Swipe</h1>
        <span className="muted">
          {properties.data.length} left
          <span className="key-hints">
            {" "}
            · <kbd>←</kbd> reject · <kbd>→</kbd> shortlist · <kbd>u</kbd> undo
          </span>
        </span>
      </div>
      <div className="deck">
        {top === undefined ? (
          <p className="muted">All caught up. Searches are polled every ten minutes.</p>
        ) : (
          <>
            {next && <SwipeCard key={next.id} property={next} />}
            <SwipeCard key={top.id} property={top} gesture={gesture} />
          </>
        )}
      </div>
      {triage.error && <p className="error">{triage.error.message}</p>}
      <div className="swipe-actions">
        <button type="button" className="reject" disabled={!canSwipe} onClick={() => gesture.fling("left")}>
          ✕ Reject
        </button>
        <button type="button" disabled={!canUndo} onClick={undo}>
          ↶ Undo
        </button>
        <button type="button" className="shortlist" disabled={!canSwipe} onClick={() => gesture.fling("right")}>
          ♥ Shortlist
        </button>
      </div>
    </section>
  );
};
