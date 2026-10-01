import { useEffect, useState, useSyncExternalStore } from "react";
import type { Durability } from "../lib/store";
import { useStore } from "./useStore";

const POLL_MS = 1000;

export type SyncStatus = {
  /** Changes that have been waiting a while to reach the server; one sent within a second never counts. */
  readonly pending: number;
  readonly durability: Durability;
  /** Why the server turned down a change, which has been undone on the device. */
  readonly refusal: string | null;
};

export const useSyncStatus = (): SyncStatus => {
  const store = useStore();
  const refusal = useSyncExternalStore(store.onRefusal, store.refusal);
  const [polled, setPolled] = useState(() => ({
    waiting: store.pending(),
    pending: 0,
    durability: store.durability(),
  }));

  useEffect(() => {
    const timer = setInterval(() => {
      setPolled((before) => {
        const waiting = store.pending();
        const next = { waiting, pending: before.waiting > 0 ? waiting : 0, durability: store.durability() };
        return before.waiting === next.waiting &&
          before.pending === next.pending &&
          before.durability === next.durability
          ? before
          : next;
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [store]);

  return { pending: polled.pending, durability: polled.durability, refusal };
};
