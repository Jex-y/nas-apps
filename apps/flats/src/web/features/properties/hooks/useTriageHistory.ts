import { useState } from "react";
import type { PropertySummary, UpdateStatus } from "../../../../contract";
import { useTriage } from "../api/properties";

/** Triage that can be taken back: `decide` moves a property out of the inbox, and `undo` returns the last one to it. */
export const useTriageHistory = () => {
  const triage = useTriage();
  const [decided, setDecided] = useState<readonly PropertySummary[]>([]);
  const last = decided.at(-1);

  return {
    decide: (property: PropertySummary, update: UpdateStatus) => {
      setDecided((properties) => [...properties, property]);
      triage.mutate({ property, update });
    },
    /** The property put back, or `null` when nothing is left to undo. */
    undo: (): PropertySummary | null => {
      if (last === undefined) {
        return null;
      }
      setDecided((properties) => properties.slice(0, -1));
      triage.mutate({ property: last, update: { status: "new" } });
      return last;
    },
    canUndo: last !== undefined,
    error: triage.error,
  };
};
