import { type AppContext, type AppModule, appRoutes, trailingSlashRedirect } from "@apps/core";
import { type Bank, createEnableBanking } from "./api/bank";
import { parseMoneyConfig } from "./api/config";
import { moneyDb } from "./api/db";
import { createMoneyMcp } from "./api/mcp";
import { createFtMarkets, type PriceSource } from "./api/prices";
import { createMoneyRoutes } from "./api/routes";
import { createMoneyService } from "./api/service";
import { createMoneyWork } from "./api/work";
import page from "./web/index.html";

/** The outside services money talks to, and the clock that dates balances; tests swap in fakes. */
export type MoneyAdapters = {
  /** `null` when Enable Banking is not configured; banks then cannot be linked. */
  readonly bank: Bank | null;
  readonly prices: PriceSource;
  readonly now: () => Date;
};

const realAdapters = (context: AppContext): MoneyAdapters => {
  const { enableBanking } = parseMoneyConfig(context.env);
  const now = () => new Date();
  return {
    bank: enableBanking === null ? null : createEnableBanking({ config: enableBanking, now }),
    prices: createFtMarkets({ intervalMs: 1_500 }),
    now,
  };
};

export const createMoneyApp = (
  context: AppContext,
  { bank, prices, now }: MoneyAdapters = realAdapters(context),
): AppModule => {
  const db = moneyDb(context.sql);
  const work = createMoneyWork({
    db,
    bank,
    prices,
    queue: context.jobs,
    notifier: (owner) => context.notifier("money", owner),
    publicUrl: context.publicUrl,
    now,
  });
  const service = createMoneyService({ db, bank, prices, work, publicUrl: context.publicUrl, now });

  return {
    slug: "money",
    title: "Money",
    routes: appRoutes({
      "/money": trailingSlashRedirect("money"),
      "/money/*": page,
      ...createMoneyRoutes({ service, identity: context.identity }),
    }),
    jobs: work.jobs,
    schedules: work.schedules,
    mcp: createMoneyMcp(service),
  };
};
