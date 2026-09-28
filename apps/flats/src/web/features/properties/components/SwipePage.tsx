import { useEffect, useState } from "react";
import type { PropertySummary, UpdateStatus } from "../../../../contract";
import { usePhotos, useProperties, useTriage } from "../api/properties";
import { type SwipeDirection, useSwipeGesture } from "../hooks/useSwipeGesture";
import { isTyping } from "../utils/keyboard";
import { SwipeCard } from "./SwipeCard";

const DECISIONS = {
  left: { status: "rejected", reason: null },
  right: { status: "shortlisted" },
} as const satisfies Record<SwipeDirection, UpdateStatus>;

type Swipe = { property: PropertySummary; direction: SwipeDirection };

/**
 * New listings one at a time: swipe or ←/→ to reject or shortlist, u to undo. Tap the photo's right side or press
 * space for the next photo, its left third or shift+space for the previous one.
 */
export const SwipePage = () => {
  const properties = useProperties("new");
  const triage = useTriage();
  const [history, setHistory] = useState<readonly Swipe[]>([]);

  const [top, next] = properties.data ?? [];
  const photos = usePhotos(top?.id).data;
  // Fetched ahead so the next card has its gallery as soon as it comes up.
  usePhotos(next?.id);
  // Keyed by property, so the next card starts from its first photo without an effect to reset it.
  const [viewing, setViewing] = useState({ propertyId: "", index: 0 });
  const photoIndex = viewing.propertyId === top?.id ? viewing.index : 0;
  const stepPhoto = (delta: number) => {
    if (top !== undefined && photos !== undefined) {
      setViewing({ propertyId: top.id, index: Math.max(0, Math.min(photos.length - 1, photoIndex + delta)) });
    }
  };

  const gesture = useSwipeGesture(
    (direction) => {
      if (top !== undefined) {
        setHistory((swipes) => [...swipes, { property: top, direction }]);
        triage.mutate({ property: top, update: DECISIONS[direction] });
      }
    },
    (target, clientX) => {
      const photo = target.closest(".swipe-photo");
      if (photo !== null) {
        const { left, width } = photo.getBoundingClientRect();
        stepPhoto(clientX < left + width / 3 ? -1 : 1);
      }
    },
  );
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
        " ": () => stepPhoto(event.shiftKey ? -1 : 1),
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
            · <kbd>←</kbd> reject · <kbd>→</kbd> shortlist · <kbd>u</kbd> undo · <kbd>space</kbd> photos
          </span>
        </span>
      </div>
      <div className="deck">
        {top === undefined ? (
          <p className="muted">All caught up. Searches are polled every ten minutes.</p>
        ) : (
          <>
            {next && <SwipeCard key={next.id} property={next} />}
            <SwipeCard key={top.id} property={top} photos={photos} photoIndex={photoIndex} gesture={gesture} />
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
