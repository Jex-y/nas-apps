import { type RefObject, useEffect, useRef } from "react";
import { advance, type Binding, strokeOf } from "../utils/keymap";

/** How long the first key of a sequence waits for the next. */
const SEQUENCE_MS = 1000;

export type Keymap = { readonly title: string; readonly bindings: readonly Binding[] };

const mounted = new Set<RefObject<Keymap>>();

/** Every keymap on the page now, innermost first, for the key help to list. */
export const mountedKeymaps = (): readonly Keymap[] => [...mounted].map((keymap) => keymap.current);

const isTyping = (target: Element) =>
  (target instanceof HTMLElement && target.isContentEditable) || target.matches("input, textarea, select");

/** Enter and the space bar already press whatever control has the focus. */
const pressesControl = (target: Element, stroke: string) =>
  ["Enter", "Space"].includes(stroke) && target.closest("a, button, summary") !== null;

/**
 * Runs `bindings` from the keyboard while mounted, except while someone is typing in a field. A modal dialog takes
 * the keys from everything behind it: pass the dialog as `scope` for bindings that belong to it.
 */
export const useKeymap = (title: string, bindings: readonly Binding[], scope?: RefObject<HTMLDialogElement | null>) => {
  const keymap = useRef<Keymap>({ title, bindings });
  keymap.current = { title, bindings };

  useEffect(() => {
    let pending: readonly string[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (event: KeyboardEvent) => {
      const { target } = event;
      const stroke = strokeOf(event);
      if (
        stroke === null ||
        !(target instanceof Element) ||
        isTyping(target) ||
        pressesControl(target, stroke) ||
        target.closest("dialog") !== (scope?.current ?? null)
      ) {
        return;
      }
      const step = advance(keymap.current.bindings, pending, stroke);
      clearTimeout(timer);
      pending = step.kind === "pending" ? step.strokes : [];
      if (step.kind === "pending") {
        timer = setTimeout(() => {
          pending = [];
        }, SEQUENCE_MS);
      }
      if (step.kind !== "miss") {
        event.preventDefault();
      }
      if (step.kind === "run") {
        step.binding.run();
      }
    };
    window.addEventListener("keydown", onKey);
    mounted.add(keymap);
    return () => {
      window.removeEventListener("keydown", onKey);
      mounted.delete(keymap);
      clearTimeout(timer);
    };
  }, [scope]);
};
