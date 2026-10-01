import { ApiError, requestEmpty, requestJson } from "@apps/core/web";
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from "@tanstack/browser-db-sqlite-persistence";
import { type Collection, createCollection, type PendingMutation } from "@tanstack/db";
import { NonRetriableError, startOfflineExecutor } from "@tanstack/offline-transactions";
import { QueryClient } from "@tanstack/query-core";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import type { z } from "zod";
import {
  type Entry,
  EntryList,
  type Exercise,
  ExerciseList,
  IDEMPOTENCY_HEADER,
  LIFTS_API,
  type LiftSet,
  LiftSetList,
  Mutation,
  type Workout,
  WorkoutList,
} from "../../contract";

/** Each collection's name, which is also its path under the API, against the row its mutations are named for. */
const ROWS = { exercises: "exercise", workouts: "workout", entries: "entry", sets: "set" } as const;
type CollectionName = keyof typeof ROWS;

/** Bumped whenever a row's shape changes, so a device drops the rows it kept and loads them again. */
const SCHEMA_VERSION = 1;

/** How long the first screen waits for the server before showing what the device already holds. */
const FIRST_LOAD_WAIT_MS = 400;

/** Refusals the server will repeat however often it is asked, as opposed to a connection that may come back. */
const isRefusal = (error: unknown): boolean =>
  error instanceof ApiError && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status);

const toMutation = (pending: PendingMutation): Mutation => {
  const row = ROWS[pending.collection.id as CollectionName];
  const mutation = Mutation.safeParse(
    pending.type === "delete"
      ? { type: `${row}.delete`, id: pending.key }
      : { type: `${row}.put`, row: pending.modified },
  );
  if (!mutation.success) {
    throw new NonRetriableError(`This change cannot be saved: ${mutation.error.message}`);
  }
  return mutation.data;
};

type Persistence = ReturnType<typeof createBrowserWASQLitePersistence>;

/** `null` where the browser cannot keep a database, such as a private window; the log then lives in memory. */
const openPersistence = async (): Promise<Persistence | null> => {
  try {
    return createBrowserWASQLitePersistence({
      database: await openBrowserWASQLiteOPFSDatabase({ databaseName: "lifts.sqlite" }),
    });
  } catch (error) {
    console.warn("The log cannot be kept on this device", error);
    return null;
  }
};

/**
 * `device`: kept here. `other-tab`: another tab of the app holds the queue of unsent changes, so this one sends
 * each change at once or not at all. `none`: the browser gave the app nowhere to keep anything.
 */
export type Durability = "device" | "other-tab" | "none";

type Listener = () => void;

export type Store = {
  readonly exercises: Collection<Exercise, string>;
  readonly workouts: Collection<Workout, string>;
  readonly entries: Collection<Entry, string>;
  readonly sets: Collection<LiftSet, string>;
  /** Where a change made without a connection is kept until it can be sent. */
  readonly durability: () => Durability;
  /**
   * Makes changes to the collections that show at once, survive a restart and reach the server together, in order,
   * whenever it can next be reached.
   */
  readonly write: (apply: () => void) => void;
  /** Changes not yet on the server. */
  readonly pending: () => number;
  /** Why the server turned down the latest change it refused, which has been undone here; `null` once dismissed. */
  readonly refusal: () => string | null;
  readonly dismissRefusal: () => void;
  readonly onRefusal: (listener: Listener) => () => void;
};

export const openStore = async (): Promise<Store> => {
  const persistence = await openPersistence();
  const queryClient = new QueryClient();

  const refetch = new Map<string, () => Promise<unknown>>();

  const collection = <T extends { id: string }>(name: CollectionName, list: z.ZodType<T[]>): Collection<T, string> => {
    const synced = queryCollectionOptions<T, unknown, string[], string>({
      id: name,
      queryClient,
      queryKey: ["lifts", name],
      queryFn: () => requestJson(`${LIFTS_API}/${name}`, list),
      getKey: (row) => row.id,
    });
    refetch.set(name, () => synced.utils.refetch());
    return persistence === null
      ? createCollection(synced)
      : createCollection(persistedCollectionOptions({ ...synced, persistence, schemaVersion: SCHEMA_VERSION }));
  };

  const collections = {
    exercises: collection("exercises", ExerciseList),
    workouts: collection("workouts", WorkoutList),
    entries: collection("entries", EntryList),
    sets: collection("sets", LiftSetList),
  };

  const executor = startOfflineExecutor({
    collections,
    mutationFns: {
      push: async ({ transaction, idempotencyKey }) => {
        const mutations = transaction.mutations.map(toMutation);
        try {
          await requestEmpty(`${LIFTS_API}/push`, {
            method: "POST",
            headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
            body: JSON.stringify({ mutations }),
          });
        } catch (error) {
          throw isRefusal(error) ? new NonRetriableError((error as ApiError).message) : error;
        }
        // Read back before the optimistic rows are dropped, so nothing flickers out and in again.
        const touched = new Set(transaction.mutations.map((mutation) => mutation.collection.id));
        await Promise.all([...touched].map((name) => refetch.get(name)?.()));
      },
    },
  });
  await executor.waitForInit();

  const loaded = Promise.all(Object.values(collections).map((each) => each.preload()));
  await Promise.race([loaded.catch(() => {}), new Promise((resolve) => setTimeout(resolve, FIRST_LOAD_WAIT_MS))]);

  let refusal: string | null = null;
  const listeners = new Set<Listener>();
  const setRefusal = (message: string | null) => {
    refusal = message;
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    ...collections,
    durability: () => (persistence === null ? "none" : executor.isOfflineEnabled ? "device" : "other-tab"),
    write: (apply) => {
      const transaction = executor.createOfflineTransaction({ mutationFnName: "push", autoCommit: false });
      transaction.mutate(apply);
      // Settles only once the server has answered, so a rejection here is the server's refusal.
      void transaction.commit().catch((error: unknown) => {
        setRefusal(error instanceof Error ? error.message : String(error));
      });
    },
    pending: () => executor.getPendingCount(),
    refusal: () => refusal,
    dismissRefusal: () => setRefusal(null),
    onRefusal: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
