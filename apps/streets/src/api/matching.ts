import { inArray } from "drizzle-orm";
import { MATCH_RADIUS_METRES } from "../contract";
import type { StreetsDb } from "./db";
import { CELLS, createGrid, densify, haversineMetres, type LatLon } from "./geo";
import { chunks } from "./progress";
import { nodes } from "./schema";

/**
 * GPS is filled in to this spacing before matching, so a node between two sparse fixes (a GPX logged every 10 s, a
 * watch's smart recording) is measured against the line between them rather than missed.
 */
const TRACK_STEP_METRES = 5;
/** Gaps longer than this are a pause, a dropout or a train, and are not credited. */
export const MAX_GAP_METRES = 200;

/** Cells of one match radius: a node can only be hit by a track point in its own cell or the eight around it. */
const MATCH_GRID = createGrid(MATCH_RADIUS_METRES);

export type CandidateNode = {
  readonly id: number;
  readonly lat: number;
  readonly lon: number;
};

export type Matcher = {
  /** The indexed cells the track's nodes could be in: every cell it passes through and those around them. */
  readonly cells: readonly number[];
  /** The ids of the candidates within {@link MATCH_RADIUS_METRES} of the track. */
  readonly hits: (candidates: readonly CandidateNode[]) => number[];
};

export const createMatcher = (track: readonly LatLon[]): Matcher => {
  const pointsByCell = new Map<number, LatLon[]>();
  const cells = new Set<number>();
  for (const point of densify(track, TRACK_STEP_METRES, MAX_GAP_METRES)) {
    const fine = MATCH_GRID.cellOf(point);
    if (fine === null) {
      continue;
    }
    const inCell = pointsByCell.get(fine);
    if (inCell === undefined) {
      pointsByCell.set(fine, [point]);
    } else {
      inCell.push(point);
    }
    const cell = CELLS.cellOf(point);
    if (cell !== null && !cells.has(cell)) {
      for (const near of CELLS.around(cell)) {
        cells.add(near);
      }
    }
  }

  const isHit = (position: LatLon) => {
    const cell = MATCH_GRID.cellOf(position);
    return (
      cell !== null &&
      MATCH_GRID.around(cell).some((near) =>
        pointsByCell.get(near)?.some((point) => haversineMetres(point, position) <= MATCH_RADIUS_METRES),
      )
    );
  };

  return {
    cells: [...cells],
    hits: (candidates) => candidates.filter((node) => isHit([node.lat, node.lon])).map((node) => node.id),
  };
};

/** Matches a track against the street nodes stored near it, a batch of cells at a time. */
export const matchTrack = async (db: StreetsDb, track: readonly LatLon[]): Promise<number[]> => {
  const matcher = createMatcher(track);
  const hit: number[] = [];
  for (const cells of chunks(matcher.cells)) {
    const candidates = await db
      .select({ id: nodes.id, lat: nodes.lat, lon: nodes.lon })
      .from(nodes)
      .where(inArray(nodes.cell, cells));
    hit.push(...matcher.hits(candidates));
  }
  return hit;
};
