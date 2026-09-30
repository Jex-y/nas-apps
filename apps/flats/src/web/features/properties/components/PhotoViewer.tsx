import { type PointerEvent, useEffect, useRef } from "react";
import type { GalleryPhoto } from "./SwipeCard";

const SWIPE_PX = 40;

/**
 * Full-screen photos, opened at `index`: ←/→, the arrow buttons, a horizontal swipe or a tap on either side step
 * through them, and Escape closes. The next photo is mounted hidden so it has loaded by the time it is shown: photo URLs redirect to freshly signed ones, so the thumbnail's copy is never a cache hit.
 */
export const PhotoViewer = ({
  photos,
  index,
  onStep,
  onClose,
}: {
  photos: readonly GalleryPhoto[];
  index: number;
  onStep: (index: number) => void;
  onClose: () => void;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedAt = useRef<number | null>(null);
  useEffect(() => dialog.current?.showModal(), []);

  const current = photos[index];
  const step = (delta: number) => onStep(Math.max(0, Math.min(photos.length - 1, index + delta)));

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
      aria-label={`Photo ${index + 1} of ${photos.length}`}
      onClose={onClose}
      onKeyDown={(event) => {
        const delta = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
        if (delta !== undefined) {
          event.preventDefault();
          step(delta);
        }
      }}
    >
      <div
        className="photo-viewer-stage"
        onPointerDown={(event) => {
          pressedAt.current = event.clientX;
        }}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          pressedAt.current = null;
        }}
      >
        {photos.slice(index, index + 2).map((photo) => (
          <img
            key={photo.url}
            src={photo.url}
            alt=""
            draggable={false}
            className={[photo.kind, photo !== current && "preload"].filter(Boolean).join(" ")}
          />
        ))}
      </div>
      <span className="photo-viewer-count">
        {index + 1} / {photos.length}
        {current?.kind === "floorplan" && " · Floorplan"}
      </span>
      <button type="button" className="photo-viewer-close" aria-label="Close" onClick={() => dialog.current?.close()}>
        ×
      </button>
      {photos.length > 1 && (
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
            disabled={index === photos.length - 1}
            onClick={() => step(1)}
          >
            ›
          </button>
        </>
      )}
    </dialog>
  );
};
