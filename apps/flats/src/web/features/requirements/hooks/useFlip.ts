import { type RefObject, useLayoutEffect, useRef } from "react";

const DURATION_MS = 320;

/**
 * Animates the children of `container` marked `data-flip` from where they were to where they now are, so a list that
 * re-sorts shows each item moving rather than jumping. `order` changes whenever the items may have moved.
 */
export const useFlip = (container: RefObject<HTMLElement | null>, order: string) => {
  const previous = useRef(new Map<string, number>());

  // biome-ignore lint/correctness/useExhaustiveDependencies: `order` is the signal to re-measure
  useLayoutEffect(() => {
    const root = container.current;
    if (root === null) {
      return;
    }
    const items = [...root.querySelectorAll<HTMLElement>("[data-flip]")];
    const tops = new Map(items.map((item) => [item.dataset.flip ?? "", item.getBoundingClientRect().top]));
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!still) {
      for (const item of items) {
        const before = previous.current.get(item.dataset.flip ?? "");
        const after = tops.get(item.dataset.flip ?? "");
        if (before !== undefined && after !== undefined && Math.abs(before - after) > 1) {
          item.animate([{ transform: `translateY(${before - after}px)` }, { transform: "none" }], {
            duration: DURATION_MS,
            easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
          });
        }
      }
    }
    previous.current = tops;
  }, [order]);
};
