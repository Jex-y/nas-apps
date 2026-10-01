import { useEffect, useState, useSyncExternalStore } from "react";
import type { Durability } from "../lib/store";
import { useStore } from "./useStore";

const POLL_MS = 2000;

export type SyncStatus = {
  /** Changes not yet on the server. */
  readonly pending: number;
  readonly durability: Durability;
  /** Why the server turned down a change, which has been undone on the device. */
  readonly refusal: string | null;
};

export const useSyncStatus = (): SyncStatus => {
  const store = useStore();
  const refusal = useSyncExternalStore(store.onRefusal, store.refusal);
  const [polled, setPolled] = useState(() => ({ pending: store.pending(), durability: store.durability() }));

  useEffect(() => {
    const timer = setInterval(() => {
      const next = { pending: store.pending(), durability: store.durability() };
      setPolled((before) => (before.pending === next.pending && before.durability === next.durability ? before : next));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [store]);

  return { ...polled, refusal };
};
