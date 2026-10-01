import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { NODE_SPACING_METRES } from "../contract";
import type { StreetsTx } from "./db";
import { type Box, between, boxesOverlap, CELLS, contains, cutLine, insideBoundary, type LatLon } from "./geo";
import type { OsmWay } from "./overpass";
import { chunks, recomputeProgress } from "./progress";
import { boroughs, nodes, refreshes, segments, streets } from "./schema";

/**
 * Streets are imported a tile of 16 × 16 cells (about 4 km square) at a time: each Overpass response is a megabyte
 * or two, so the worker never holds more than a sliver of London's network.
 */
export const TILE_CELLS = 16;

export type Tile = { readonly row: number; readonly col: number };

const tileBlock = ({ row, col }: Tile) =>
  [row * TILE_CELLS, col * TILE_CELLS, (row + 1) * TILE_CELLS - 1, (col + 1) * TILE_CELLS - 1] as const;

export const tileBox = (tile: Tile): Box => CELLS.blockBox(...tileBlock(tile));
export const tileCells = (tile: Tile): number[] => CELLS.block(...tileBlock(tile));

/** Every tile overlapping at least one of the boxes. */
export const tilesOver = (boxes: readonly Box[]): Tile[] =>
  Array.from({ length: Math.ceil(CELLS.rows / TILE_CELLS) }, (_, row) =>
    Array.from({ length: Math.ceil(CELLS.cols / TILE_CELLS) }, (_, col) => ({ row, col })),
  )
    .flat()
    .filter((tile) => boxes.some((box) => boxesOverlap(box, tileBox(tile))));

export type BoroughShape = {
  readonly id: number;
  readonly box: Box;
  readonly boundary: readonly (readonly LatLon[])[];
};

/** Finds a point's borough, trying the last one found first: consecutive points are nearly always in the same one. */
const createLocator = (shapes: readonly BoroughShape[]) => {
  let last: BoroughShape | undefined;
  const within = (shape: BoroughShape, point: LatLon) =>
    contains(shape.box, point) && insideBoundary(point, shape.boundary);
  return (point: LatLon): number | null => {
    if (last === undefined || !within(last, point)) {
      last = shapes.find((shape) => within(shape, point));
    }
    return last?.id ?? null;
  };
};

export type TileStreet = { readonly boroughId: number; readonly name: string };
export type TileNode = {
  readonly street: string;
  readonly key: number;
  readonly position: LatLon;
  readonly cell: number;
};
export type TileSegment = {
  readonly street: string;
  readonly wayId: number;
  readonly seq: number;
  readonly cell: number;
  readonly path: readonly LatLon[];
};

export type TileContent = {
  /** Keyed by {@link streetKey}. */
  readonly streets: ReadonlyMap<string, TileStreet>;
  readonly nodes: readonly TileNode[];
  readonly segments: readonly TileSegment[];
};

const streetKey = (boroughId: number, name: string) => `${boroughId}\n${name}`;

/** Deterministic, so re-importing an unchanged way updates its interpolated nodes rather than adding more. */
export const interpolatedKey = (wayId: number, index: number): number => -(wayId * 100_000 + index);

/** Six decimal places is 0.1 m, and keeps drawn paths small. */
const rounded = ([lat, lon]: LatLon): LatLon => [Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6];

/**
 * Turns a tile's ways into streets, nodes and drawable segments. A street is one name within one borough, so a road
 * crossing a borough boundary counts once in each, and its nodes go to whichever borough they fall in. Points outside
 * every borough (the tile's overlap beyond Greater London) are dropped.
 */
export const buildTile = (ways: readonly OsmWay[], shapes: readonly BoroughShape[]): TileContent => {
  const locate = createLocator(shapes);
  const tileStreets = new Map<string, TileStreet>();
  const tileNodes = new Map<string, TileNode>();
  const tileSegments: TileSegment[] = [];

  const streetAt = (point: LatLon, name: string): string | null => {
    const boroughId = locate(point);
    if (boroughId === null) {
      return null;
    }
    const key = streetKey(boroughId, name);
    tileStreets.set(key, { boroughId, name });
    return key;
  };

  for (const way of ways) {
    let interpolated = 0;
    const addNode = (key: number, position: LatLon) => {
      const street = streetAt(position, way.name);
      const cell = CELLS.cellOf(position);
      if (street !== null && cell !== null) {
        tileNodes.set(`${street}\n${key}`, { street, key, position: rounded(position), cell });
      }
    };
    way.geometry.forEach((position, index) => {
      const previous = way.geometry[index - 1];
      if (previous !== undefined) {
        for (const point of between(previous, position, NODE_SPACING_METRES)) {
          addNode(interpolatedKey(way.id, interpolated++), point);
        }
      }
      addNode(way.nodes[index] as number, position);
    });

    cutLine(way.geometry, CELLS.metres).forEach((path, seq) => {
      const street = streetAt(path[Math.floor(path.length / 2)] as LatLon, way.name);
      const cell = CELLS.cellOf(path[0] as LatLon);
      if (street !== null && cell !== null) {
        tileSegments.push({ street, wayId: way.id, seq, cell, path: path.map(rounded) });
      }
    });
  }

  return { streets: tileStreets, nodes: [...tileNodes.values()], segments: tileSegments };
};

/** Recounts streets' nodes and moves their centres, which suggestions start from. */
const refreshStreets = async (tx: StreetsTx, streetIds: readonly number[]) => {
  for (const ids of chunks(streetIds)) {
    const centres = await tx.execute<{ id: number; count: number; lat: number | null; lon: number | null }>(sql`
      update streets.streets s set node_count = agg.count, center_lat = agg.lat, center_lon = agg.lon
      from (
        select t.id, count(n.id)::int as count, avg(n.lat) as lat, avg(n.lon) as lon
        from streets.streets t left join streets.nodes n on n.street_id = t.id
        where t.id in ${ids}
        group by t.id
      ) agg
      where s.id = agg.id
      returning s.id, agg.count, agg.lat, agg.lon
    `);
    const cells = [...centres].flatMap(({ id, lat, lon }) => {
      const cell = lat === null || lon === null ? null : CELLS.cellOf([lat, lon]);
      return cell === null ? [] : [sql`(${id}::int, ${cell}::int)`];
    });
    if (cells.length > 0) {
      await tx.execute(sql`
        update streets.streets s set cell = v.cell
        from (values ${sql.join(cells, sql`, `)}) as v(id, cell)
        where s.id = v.id
      `);
    }
  }
};

/**
 * Writes one tile of a refresh: upserts what OSM has now, sweeps what it no longer has (anything in the tile's cells
 * that this refresh did not write), and updates every touched street's counts and every login's progress on them.
 * Resolves the number of nodes that are new, which only re-matching old activities can credit.
 */
export const saveTile = async (
  tx: StreetsTx,
  content: TileContent,
  { generation, cells }: { readonly generation: number; readonly cells: readonly number[] },
): Promise<number> => {
  const streetIds = new Map<string, number>();
  for (const batch of chunks([...content.streets])) {
    const saved = await tx
      .insert(streets)
      .values(batch.map(([, street]) => street))
      .onConflictDoUpdate({ target: [streets.boroughId, streets.name], set: { name: sql`excluded.name` } })
      .returning({ id: streets.id, boroughId: streets.boroughId, name: streets.name });
    for (const street of saved) {
      streetIds.set(streetKey(street.boroughId, street.name), street.id);
    }
  }
  const idOf = (street: string) => {
    const id = streetIds.get(street);
    if (id === undefined) {
      throw new Error(`Street ${street} was not saved`);
    }
    return id;
  };

  let added = 0;
  for (const batch of chunks(content.nodes)) {
    const saved = await tx
      .insert(nodes)
      .values(
        batch.map(({ street, key, position: [lat, lon], cell }) => ({
          streetId: idOf(street),
          key,
          lat,
          lon,
          cell,
          generation,
        })),
      )
      .onConflictDoUpdate({
        target: [nodes.streetId, nodes.key],
        set: {
          lat: sql`excluded.lat`,
          lon: sql`excluded.lon`,
          cell: sql`excluded.cell`,
          generation: sql`greatest(${nodes.generation}, excluded.generation)`,
        },
      })
      .returning({ inserted: sql<boolean>`xmax = 0` });
    added += saved.filter((row) => row.inserted).length;
  }

  for (const batch of chunks(content.segments)) {
    await tx
      .insert(segments)
      .values(
        batch.map(({ street, wayId, seq, cell, path }) => ({
          streetId: idOf(street),
          wayId,
          seq,
          cell,
          path: [...path],
          generation,
        })),
      )
      .onConflictDoUpdate({
        target: [segments.wayId, segments.seq],
        set: {
          streetId: sql`excluded.street_id`,
          cell: sql`excluded.cell`,
          path: sql`excluded.path`,
          generation: sql`greatest(${segments.generation}, excluded.generation)`,
        },
      });
  }

  const stale = await tx
    .delete(nodes)
    .where(and(inArray(nodes.cell, [...cells]), lt(nodes.generation, generation)))
    .returning({ streetId: nodes.streetId });
  await tx.delete(segments).where(and(inArray(segments.cell, [...cells]), lt(segments.generation, generation)));

  const touched = [...new Set([...streetIds.values(), ...stale.map((row) => row.streetId)])];
  await refreshStreets(tx, touched);
  await recomputeProgress(tx, touched, null);
  return added;
};

/** Counts a tile done; after the last one, drops what OSM no longer has anywhere. Resolves whether it was the last. */
export const finishTile = async (tx: StreetsTx, refreshId: number): Promise<boolean> => {
  const [refresh] = await tx
    .update(refreshes)
    .set({ tilesDone: sql`${refreshes.tilesDone} + 1` })
    .where(eq(refreshes.id, refreshId))
    .returning({ tiles: refreshes.tiles, tilesDone: refreshes.tilesDone });
  if (refresh === undefined || refresh.tilesDone !== refresh.tiles) {
    return false;
  }
  await tx.delete(streets).where(eq(streets.nodeCount, 0));
  await tx.delete(boroughs).where(lt(boroughs.generation, refreshId));
  await tx.update(refreshes).set({ finishedAt: sql`now()` }).where(eq(refreshes.id, refreshId));
  return true;
};
