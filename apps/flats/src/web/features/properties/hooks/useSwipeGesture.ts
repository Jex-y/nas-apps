import { type PointerEvent, type RefObject, useRef, useState } from "react";

export type SwipeDirection = "left" | "right";

type Gesture =
  | { kind: "idle" }
  | {
      kind: "dragging";
      pointerId: number;
      /** What the pointer went down on; capture retargets the later events to the card. */
      target: Element;
      originX: number;
      width: number;
      dx: number;
      lastX: number;
      lastTime: number;
      velocity: number;
    }
  | { kind: "flinging"; direction: SwipeDirection };

const COMMIT_FRACTION = 0.3;
const FLICK_PX_PER_MS = 0.5;
const FLICK_MIN_PX = 24;
/** Movement below this is a tap, not a drag. */
const TAP_MAX_PX = 8;

const SIGN = { left: -1, right: 1 } as const satisfies Record<SwipeDirection, number>;

const transformFor = (dx: number) => `translateX(${dx}px) rotate(${dx / 20}deg)`;

export type SwipeGesture = {
  ref: RefObject<HTMLElement | null>;
  handlers: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: () => void;
  };
  /** Signed progress towards committing, from -1 (left) to 1 (right). */
  lean: number;
  /** Set only while a finger is down; otherwise the card's CSS transition owns the transform. */
  transform: string | undefined;
  busy: boolean;
  fling: (direction: SwipeDirection) => void;
};

/**
 * Drags the element under `ref` sideways and calls `onSwipe` once it has flown off past the threshold. A press that
 * barely moves calls `onTap` instead, with the element it landed on.
 */
export const useSwipeGesture = (
  onSwipe: (direction: SwipeDirection) => void,
  onTap: (target: Element, clientX: number) => void = () => undefined,
): SwipeGesture => {
  const ref = useRef<HTMLElement>(null);
  const [gesture, setGesture] = useState<Gesture>({ kind: "idle" });

  const fling = (direction: SwipeDirection) => {
    if (gesture.kind === "flinging") {
      return;
    }
    const sign = SIGN[direction];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setGesture({ kind: "flinging", direction });
    const animation = ref.current?.animate(
      [
        { transform: transformFor(gesture.kind === "dragging" ? gesture.dx : 0) },
        { transform: `translateX(${sign * 150}%) rotate(${sign * 30}deg)` },
      ],
      // `fill` holds the card off-screen until the list drops it; without it, it snaps back for a frame.
      { duration: reduced ? 0 : 250, easing: "ease-in", fill: "forwards" },
    );
    void (animation?.finished ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => {
        onSwipe(direction);
        setGesture({ kind: "idle" });
      });
  };

  const handlers: SwipeGesture["handlers"] = {
    onPointerDown: (event) => {
      const { target } = event;
      const onControl = target instanceof Element && target.closest("a, button") !== null;
      if (
        gesture.kind !== "idle" ||
        !event.isPrimary ||
        event.button !== 0 ||
        onControl ||
        !(target instanceof Element)
      ) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      setGesture({
        kind: "dragging",
        pointerId: event.pointerId,
        target,
        originX: event.clientX,
        width: event.currentTarget.offsetWidth,
        dx: 0,
        lastX: event.clientX,
        lastTime: event.timeStamp,
        velocity: 0,
      });
    },
    onPointerMove: (event) => {
      if (gesture.kind !== "dragging" || event.pointerId !== gesture.pointerId) {
        return;
      }
      const elapsed = event.timeStamp - gesture.lastTime;
      setGesture({
        ...gesture,
        dx: event.clientX - gesture.originX,
        lastX: event.clientX,
        lastTime: event.timeStamp,
        velocity: elapsed > 0 ? (event.clientX - gesture.lastX) / elapsed : gesture.velocity,
      });
    },
    onPointerUp: (event) => {
      if (gesture.kind !== "dragging" || event.pointerId !== gesture.pointerId) {
        return;
      }
      const { dx, velocity, width, target } = gesture;
      if (Math.abs(dx) < TAP_MAX_PX) {
        setGesture({ kind: "idle" });
        onTap(target, event.clientX);
        return;
      }
      const flicked =
        Math.abs(velocity) > FLICK_PX_PER_MS && Math.sign(velocity) === Math.sign(dx) && Math.abs(dx) > FLICK_MIN_PX;
      if (Math.abs(dx) > width * COMMIT_FRACTION || flicked) {
        fling(dx > 0 ? "right" : "left");
      } else {
        setGesture({ kind: "idle" });
      }
    },
    onPointerCancel: () => setGesture({ kind: "idle" }),
  };

  const lean =
    gesture.kind === "dragging"
      ? Math.max(-1, Math.min(1, gesture.dx / (gesture.width * COMMIT_FRACTION)))
      : gesture.kind === "flinging"
        ? SIGN[gesture.direction]
        : 0;

  return {
    ref,
    handlers,
    lean,
    transform: gesture.kind === "dragging" ? transformFor(gesture.dx) : undefined,
    busy: gesture.kind === "flinging",
    fling,
  };
};
