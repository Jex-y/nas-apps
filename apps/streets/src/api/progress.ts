import { inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { COMPLETION_PERCENT } from "../contract";
import type { StreetsTx } from "./db";
import { nodeHits, nodes } from "./schema";

/** Rows per multi-row statement, well inside Postgres' 65,535 bind parameters. */
export const BATCH = 1_000;

export const chunks = <T>(items: readonly T[], size = BATCH): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

export type Completion = { readonly login: string; readonly streetId: number };

const Completions = z.array(z.object({ login: z.string(), street_id: z.number() }));

/**
 * Rebuilds `street_progress` for the given streets from `node_hits`, for one login or (after a street import) all.
 * Completion is order-independent: a street completes at the hit that brought it to the threshold in activity time,
 * whichever order the activities were matched in, so a backfill that runs newest first still dates it right.
 * Resolves the streets that were not complete before and are now.
 */
export const recomputeProgress = async (
  tx: StreetsTx,
  streetIds: readonly number[],
  login: string | null,
): Promise<Completion[]> => {
  const completions: Completion[] = [];
  for (const ids of chunks([...new Set(streetIds)])) {
    const forLogin = (column: string) => (login === null ? sql`` : sql`and ${sql.raw(column)} = ${login}`);
    const rows = await tx.execute(sql`
      with ranked as (
        select h.login, n.street_id, h.hit_at, h.activity_id,
          row_number() over (partition by h.login, n.street_id order by h.hit_at, h.activity_id) as rank,
          count(*) over (partition by h.login, n.street_id) as hits
        from streets.node_hits h
        join streets.nodes n on n.id = h.node_id
        where n.street_id in ${ids} ${forLogin("h.login")}
      ),
      fresh as (
        select r.login, r.street_id, max(r.hits)::int as hit_count,
          min(r.hit_at) filter (where r.rank = s.required) as completed_at,
          (array_agg(r.activity_id) filter (where r.rank = s.required))[1] as completed_activity_id
        from ranked r
        join (
          select id, (node_count * ${COMPLETION_PERCENT}::int + 99) / 100 as required from streets.streets
        ) s on s.id = r.street_id
        group by r.login, r.street_id
      ),
      before as (
        select p.login, p.street_id, p.completed_at from streets.street_progress p
        where p.street_id in ${ids} ${forLogin("p.login")}
      ),
      removed as (
        delete from streets.street_progress p
        where p.street_id in ${ids} ${forLogin("p.login")}
          and not exists (select from fresh f where f.login = p.login and f.street_id = p.street_id)
      ),
      saved as (
        insert into streets.street_progress (login, street_id, hit_count, completed_at, completed_activity_id)
        select login, street_id, hit_count, completed_at, completed_activity_id from fresh
        on conflict (login, street_id) do update set
          hit_count = excluded.hit_count,
          completed_at = excluded.completed_at,
          completed_activity_id = excluded.completed_activity_id
        returning login, street_id, completed_at
      )
      select saved.login, saved.street_id from saved
      left join before on before.login = saved.login and before.street_id = saved.street_id
      where saved.completed_at is not null and before.completed_at is null
    `);
    completions.push(...Completions.parse(rows).map((row) => ({ login: row.login, streetId: row.street_id })));
  }
  return completions;
};

export type Hits = {
  readonly login: string;
  readonly activityId: string;
  /** When the activity started; a node keeps the earliest activity that ran past it. */
  readonly hitAt: Date;
  readonly nodeIds: readonly number[];
};

/**
 * Credits the nodes to the activity and brings their streets' progress up to date. Idempotent: re-importing or
 * re-matching an activity writes the same hits, so nothing is counted twice.
 */
export const recordHits = async (tx: StreetsTx, { login, activityId, hitAt, nodeIds }: Hits): Promise<Completion[]> => {
  const streetIds: number[] = [];
  for (const ids of chunks(nodeIds)) {
    await tx
      .insert(nodeHits)
      .values(ids.map((nodeId) => ({ login, nodeId, activityId, hitAt })))
      .onConflictDoUpdate({
        target: [nodeHits.login, nodeHits.nodeId],
        set: { activityId: sql`excluded.activity_id`, hitAt: sql`excluded.hit_at` },
        setWhere: sql`excluded.hit_at < ${nodeHits.hitAt}`,
      });
    const hit = await tx.selectDistinct({ streetId: nodes.streetId }).from(nodes).where(inArray(nodes.id, ids));
    streetIds.push(...hit.map((row) => row.streetId));
  }
  return recomputeProgress(tx, streetIds, login);
};
