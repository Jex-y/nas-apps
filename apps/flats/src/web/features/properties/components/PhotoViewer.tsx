import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useKeymap } from "../../../hooks/useKeymap";
import type { Binding } from "../../../utils/keymap";
import { LOCATION_ZOOM } from "../../map/components/LocationMap";
import { type Slide, slideBindings, stepFrom } from "../utils/slides";
import { SlideView } from "./SlideView";

const SWIPE_PX = 40;

const LABELS = { photo: null, floorplan: "Floorplan", map: "Map" } as const satisfies Record<Slide["kind"], unknown>;

/**
 * Full-screen slides, opened at `index`: h/l or ←/→, the arrow buttons, a horizontal swipe or a tap on either side
 * step through them, f and m jump to the floorplan and the map, +/- zoom the map, and q or Escape closes.
 * `bindings` add keys of the caller's own, and the children caption the slide.
 */
export const PhotoViewer = ({
  slides,
  index,
  onStep,
  onClose,
  bindings = [],
  children,
}: {
  slides: readonly Slide[];
  index: number;
  onStep: (index: number) => void;
  onClose: () => void;
  bindings?: readonly Binding[];
  children?: ReactNode;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedAt = useRef<number | null>(null);
  const [zoom, setZoom] = useState(LOCATION_ZOOM);
  useEffect(() => {
    dialog.current?.showModal();
    // On a button, the space bar and Enter would press it.
    dialog.current?.focus();
  }, []);

  const current = slides[index];
  const label = current === undefined ? null : LABELS[current.kind];
  const step = (delta: number) => onStep(stepFrom(slides, index, delta));

  useKeymap(
    "Photos",
    [
      ...slideBindings(slides, index, onStep),
      { keys: ["ArrowRight"], does: "Next photo", run: () => step(1) },
      { keys: ["ArrowLeft"], does: "Previous photo", run: () => step(-1) },
      { keys: ["+", "="], does: "Zoom the map in", run: () => setZoom((level) => Math.min(18, level + 1)) },
      { keys: ["-"], does: "Zoom the map out", run: () => setZoom((level) => Math.max(8, level - 1)) },
      { keys: ["q"], does: "Close", run: () => dialog.current?.close() },
      ...bindings,
    ],
    dialog,
  );

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const startX = pressedAt.current;
    pressedAt.current = null;
    if (startX === null) {
      return;
    }
    const dx = event.clientX - startX;
    if (Math.abs(dx) >= SWIPE_PX) {
      step(dx < 0 ? 1 : -1);
    } else {
      const { left, width } = event.currentTarget.getBoundingClientRect();
      step(event.clientX < left + width / 3 ? -1 : 1);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="photo-viewer"
      tabIndex={-1}
      aria-label={`Photo ${index + 1} of ${slides.length}`}
      onClose={onClose}
    >
      <div
        className="photo-viewer-stage"
        onPointerDown={(event) => {
          // A drag on the map moves the map.
          pressedAt.current = current?.kind === "map" ? null : event.clientX;
        }}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          pressedAt.current = null;
        }}
      >
        <SlideView slides={slides} index={index} zoom={zoom} interactive />
      </div>
      <span className="photo-viewer-count">
        {index + 1} / {slides.length}
        {label !== null && ` · ${label}`}
      </span>
      {children && <div className="photo-viewer-caption">{children}</div>}
      <button type="button" className="photo-viewer-close" aria-label="Close" onClick={() => dialog.current?.close()}>
        ×
      </button>
      {slides.length > 1 && (
        <>
          <button
            type="button"
            className="photo-viewer-prev"
            aria-label="Previous photo"
            disabled={index === 0}
            onClick={() => step(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="photo-viewer-next"
            aria-label="Next photo"
            disabled={index === slides.length - 1}
            onClick={() => step(1)}
          >
            ›
          </button>
        </>
      )}
    </dialog>
  );
};
