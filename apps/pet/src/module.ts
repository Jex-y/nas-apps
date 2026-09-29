import { type AppContext, type AppModule, appRoutes, trailingSlashRedirect } from "@apps/core";
import { petDb } from "./api/db";
import { createPetRoutes } from "./api/routes";
import { createPetWork } from "./api/work";
import page from "./web/index.html";

/** The clock and the dice; tests pin both. */
export type PetAdapters = {
  readonly now: () => Date;
  readonly random: () => number;
};

const realAdapters: PetAdapters = { now: () => new Date(), random: Math.random };

export const createPetApp = (context: AppContext, adapters: PetAdapters = realAdapters): AppModule => {
  const db = petDb(context.sql);
  const work = createPetWork({
    db,
    queue: context.jobs,
    notifier: (login) => context.notifier("pet", login),
    publicUrl: context.publicUrl,
    now: adapters.now,
  });

  return {
    slug: "pet",
    title: "Pet",
    routes: appRoutes({
      "/pet": trailingSlashRedirect("pet"),
      "/pet/*": page,
      ...createPetRoutes({ db, identity: context.identity, work, ...adapters }),
    }),
    jobs: work.jobs,
    schedules: work.schedules,
  };
};
