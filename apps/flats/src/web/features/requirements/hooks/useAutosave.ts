import { useEffect, useRef } from "react";
import type { Requirements } from "../../../../contract";
import { putRequirements, useSaveRequirements } from "../api/requirements";

/** Long enough to type a word or drag a slider without saving each step of it. */
const SETTLE_MS = 800;

/**
 * Saves `unsaved` once edits settle; `null` means there is nothing to save. Anything still waiting is saved at once when
 * the editor closes, the page is hidden, or the tab goes away. Saves run one at a time, so the newest lands last.
 */
export const useAutosave = (unsaved: Requirements | null) => {
  const save = useSaveRequirements();
  const { mutate } = save;
  const pending = useRef<Requirements | null>(null);

  useEffect(() => {
    pending.current = unsaved;
    if (unsaved === null) {
      return;
    }
    const timer = setTimeout(() => {
      if (pending.current === unsaved) {
        pending.current = null;
        mutate(unsaved);
      }
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [unsaved, mutate]);

  useEffect(() => {
    const take = () => {
      const waiting = pending.current;
      pending.current = null;
      return waiting;
    };
    const hidden = () => {
      const waiting = document.visibilityState === "hidden" ? take() : null;
      if (waiting !== null) {
        mutate(waiting);
      }
    };
    // The page is going away, so a mutation, which starts its request a tick later, might never send it.
    const leaving = () => {
      const waiting = take();
      if (waiting !== null) {
        void putRequirements(waiting);
      }
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leaving);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leaving);
      const waiting = take();
      if (waiting !== null) {
        mutate(waiting);
      }
    };
  }, [mutate]);

  return save;
};
