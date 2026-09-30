import { useCallback, useEffect, useRef, useState } from "react";
import type { Requirements, StoredAnswer } from "../../../../contract";
import { tryOn } from "../api/requirements";

/** Jev takes a few seconds a flat; three at a time keeps a long list moving without a burst of requests. */
const AT_ONCE = 3;

export type Asking =
  | { readonly kind: "idle" }
  | { readonly kind: "asking"; readonly done: number; readonly total: number }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Asks Jev about a draft's new wordings, flat by flat, keeping its answers for this session by property id. Nothing is
 * saved: saving the requirements asks Jev again for the flats still in play.
 */
export const useAskJev = () => {
  const [asked, setAsked] = useState<ReadonlyMap<string, readonly StoredAnswer[]>>(new Map());
  const [asking, setAsking] = useState<Asking>({ kind: "idle" });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const cancel = useCallback(() => {
    controller.current?.abort();
    setAsking({ kind: "idle" });
  }, []);

  const ask = useCallback(
    async (requirements: Requirements, fingerprints: ReadonlyMap<string, string>, propertyIds: readonly string[]) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      const queue = [...propertyIds];
      let done = 0;
      setAsking({ kind: "asking", done, total: queue.length });

      const next = async (): Promise<void> => {
        const propertyId = queue.shift();
        if (propertyId === undefined || current.signal.aborted) {
          return;
        }
        const trial = await tryOn(requirements, propertyId, current.signal);
        const answers = trial.answers.flatMap(({ key, answer }) => {
          const fingerprint = fingerprints.get(key);
          return answer === null || fingerprint === undefined ? [] : [{ questionKey: key, fingerprint, answer }];
        });
        setAsked((previous) => new Map(previous).set(propertyId, [...(previous.get(propertyId) ?? []), ...answers]));
        done += 1;
        setAsking({ kind: "asking", done, total: propertyIds.length });
        return next();
      };

      try {
        await Promise.all(Array.from({ length: Math.min(AT_ONCE, queue.length) }, next));
        if (!current.signal.aborted) {
          setAsking({ kind: "idle" });
        }
      } catch (error) {
        current.abort();
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setAsking({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
        }
      }
    },
    [],
  );

  return { asked, asking, ask, cancel };
};
