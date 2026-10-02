import { useState } from "react";
import { useLocation } from "wouter";
import type { UpdateStatus } from "../../../../contract";
import { useKeymap } from "../../../hooks/useKeymap";
import { useInbox, useSlides } from "../api/properties";
import { type SwipeDirection, useSwipeGesture } from "../hooks/useSwipeGesture";
import { useTriageHistory } from "../hooks/useTriageHistory";
import { openOnPortal } from "../utils/portal";
import { slideBindings, stepFrom } from "../utils/slides";
import { SwipeCard } from "./SwipeCard";

const DECISIONS = {
  left: { status: "rejected", reason: null },
  right: { status: "shortlisted" },
} as const satisfies Record<SwipeDirection, UpdateStatus>;

/**
 * New listings one at a time: swipe, ←/→ or x/s to reject or shortlist, u to undo. Tap the photo's right side or
 * press l for the next photo, its left third or h for the previous one; the last is where it is on the map.
 */
export const SwipePage = () => {
  const properties = useInbox();
  const triage = useTriageHistory();
  const [, navigate] = useLocation();

  const [top, next] = properties.data ?? [];
  const slides = useSlides(top?.id).data;
  // Fetched ahead so the next card has its gallery as soon as it comes up.
  useSlides(next?.id);
  // Keyed by property, so the next card starts from its first photo without an effect to reset it.
  const [viewing, setViewing] = useState({ propertyId: "", index: 0 });
  const slideIndex = viewing.propertyId === top?.id ? viewing.index : 0;
  const showSlide = (index: number) => {
    if (top !== undefined) {
      setViewing({ propertyId: top.id, index });
    }
  };
  const stepSlide = (delta: number) => showSlide(stepFrom(slides ?? [], slideIndex, delta));

  const gesture = useSwipeGesture(
    (direction) => {
      if (top !== undefined) {
        triage.decide(top, DECISIONS[direction]);
      }
    },
    (target, clientX) => {
      const photo = target.closest(".swipe-photo");
      if (photo !== null) {
        const { left, width } = photo.getBoundingClientRect();
        stepSlide(clientX < left + width / 3 ? -1 : 1);
      }
    },
  );
  const canSwipe = top !== undefined && !gesture.busy;
  const canUndo = triage.canUndo && !gesture.busy;
  const fling = (direction: SwipeDirection) => () => {
    if (canSwipe) {
      gesture.fling(direction);
    }
  };
  const undo = () => {
    if (canUndo) {
      triage.undo();
    }
  };

  useKeymap("Swipe", [
    { keys: ["s", "ArrowRight"], does: "Shortlist", run: fling("right") },
    { keys: ["x", "ArrowLeft"], does: "Reject", run: fling("left") },
    { keys: ["u"], does: "Undo", run: undo },
    ...slideBindings(slides ?? [], slideIndex, showSlide),
    { keys: ["Space"], does: "Next photo", run: () => stepSlide(1) },
    { keys: ["shift+Space"], does: "Previous photo", run: () => stepSlide(-1) },
    { keys: ["o", "Enter"], does: "Open the details", run: () => top && navigate(`/properties/${top.id}`) },
    { keys: ["g x"], does: "Open on the portal", run: () => top && openOnPortal(top) },
  ]);

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
            · <kbd>x</kbd> reject · <kbd>s</kbd> shortlist · <kbd>h</kbd>/<kbd>l</kbd> photos · <kbd>m</kbd> map ·{" "}
            <kbd>?</kbd> keys
          </span>
        </span>
      </div>
      <div className="deck">
        {top === undefined ? (
          <p className="muted">All caught up. Searches are polled every ten minutes.</p>
        ) : (
          <>
            {next && <SwipeCard key={next.id} property={next} />}
            <SwipeCard key={top.id} property={top} slides={slides} slideIndex={slideIndex} gesture={gesture} />
          </>
        )}
      </div>
      {triage.error && <p className="error">{triage.error.message}</p>}
      <div className="swipe-actions">
        <button type="button" className="reject" disabled={!canSwipe} onClick={fling("left")}>
          ✕ Reject
        </button>
        <button type="button" disabled={!canUndo} onClick={undo}>
          ↶ Undo
        </button>
        <button type="button" className="shortlist" disabled={!canSwipe} onClick={fling("right")}>
          ♥ Shortlist
        </button>
      </div>
    </section>
  );
};
