import { z } from "zod";
import type { Box, LatLon } from "./geo";

/** Overpass asks every client to identify itself, and refuses requests that do not. */
const USER_AGENT = "tailnet-apps-streets/1.0 (personal street tracker)";

/** Tried in turn on each attempt, so one busy instance does not stall an import. */
export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
] as const;

/** The Overpass API; tests swap in a fake that answers from recorded fixtures. */
export type Overpass = {
  /** Resolves the parsed JSON; throws on a busy or failing server, so the calling job retries with backoff. */
  readonly query: (ql: string, signal: AbortSignal, attempt: number) => Promise<unknown>;
};

export const createOverpass = (send: typeof fetch = fetch): Overpass => ({
  query: async (ql, signal, attempt) => {
    const endpoint = OVERPASS_ENDPOINTS[(attempt - 1) % OVERPASS_ENDPOINTS.length] as string;
    const response = await send(endpoint, {
      method: "POST",
      signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      body: new URLSearchParams({ data: ql }),
    });
    if (!response.ok) {
      throw new Error(`Overpass ${endpoint} failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
  },
});

/**
 * Roads a runner can use, as CityStrides counts them: named ways of these types. Motorways, their links and paths
 * (footway, path, cycleway, track, steps, bridleway) are left out; so, below, are private or foot-forbidden ways,
 * areas, and driveways, car-park aisles and drive-throughs.
 */
export const HIGHWAYS = [
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
  "pedestrian",
  "service",
  "road",
] as const;

const EXCLUDED_ACCESS = new Set(["private", "no", "customers", "delivery", "agricultural", "forestry"]);
const ALLOWED_FOOT = new Set(["yes", "designated", "permissive"]);
const EXCLUDED_SERVICE = new Set(["driveway", "parking_aisle", "drive-through", "emergency_access"]);

export const isRunnable = (tags: Readonly<Record<string, string>>): boolean =>
  Boolean(tags.name?.trim()) &&
  (HIGHWAYS as readonly string[]).includes(tags.highway ?? "") &&
  tags.area !== "yes" &&
  tags.foot !== "no" &&
  !(EXCLUDED_ACCESS.has(tags.access ?? "") && !ALLOWED_FOOT.has(tags.foot ?? "")) &&
  !EXCLUDED_SERVICE.has(tags.service ?? "");

const bbox = ({ south, west, north, east }: Box) =>
  [south, west, north, east].map((value) => value.toFixed(5)).join(",");

/** London's boroughs are level 8 and the City level 6; their GSS codes (E09…) tell them from Surrey's and Kent's. */
export const boroughListQuery = (box: Box): string =>
  `[out:json][timeout:180];rel(${bbox(box)})[boundary=administrative][admin_level~"^[68]$"];out tags;`;

export const boroughQuery = (relationId: number): string => `[out:json][timeout:180];rel(${relationId});out geom;`;

export const tileQuery = (box: Box): string =>
  `[out:json][timeout:180];way(${bbox(box)})[highway~"^(${HIGHWAYS.join("|")})$"][name];out geom;`;

const Tags = z.record(z.string(), z.string()).default({});
const Coordinate = z.object({ lat: z.number(), lon: z.number() });
const position = ({ lat, lon }: z.infer<typeof Coordinate>): LatLon => [lat, lon];

const BoroughList = z.object({
  elements: z.array(z.object({ type: z.string(), id: z.number(), tags: Tags })),
});

export type BoroughRef = { readonly id: number; readonly name: string };

const shortName = (name: string) => name.replace(/^(London Borough of|Royal Borough of) /, "");

export const parseBoroughList = (body: unknown): BoroughRef[] =>
  BoroughList.parse(body)
    .elements.filter((element) => element.type === "relation" && element.tags["ref:gss"]?.startsWith("E09"))
    .map((element) => ({ id: element.id, name: shortName(element.tags.name ?? `Borough ${element.id}`) }));

const BoroughGeometry = z.object({
  elements: z.array(
    z.object({
      type: z.string(),
      id: z.number(),
      members: z
        .array(z.object({ type: z.string(), role: z.string(), geometry: z.array(Coordinate.nullable()).optional() }))
        .default([]),
    }),
  ),
});

/** A borough's boundary as its member ways' lines (outer and inner, unjoined). */
export const parseBoroughBoundary = (body: unknown, relationId: number): LatLon[][] => {
  const relation = BoroughGeometry.parse(body).elements.find(
    (element) => element.type === "relation" && element.id === relationId,
  );
  if (relation === undefined) {
    throw new Error(`Overpass returned no relation ${relationId}`);
  }
  return relation.members
    .filter((member) => member.type === "way" && (member.role === "outer" || member.role === "inner"))
    .map((member) => (member.geometry ?? []).filter((point) => point !== null).map(position))
    .filter((line) => line.length > 1);
};

export type OsmWay = {
  readonly id: number;
  readonly name: string;
  /** OSM node ids, parallel to `geometry`. */
  readonly nodes: readonly number[];
  readonly geometry: readonly LatLon[];
};

const Ways = z.object({
  elements: z.array(
    z.object({
      type: z.string(),
      id: z.number(),
      nodes: z.array(z.number()).default([]),
      geometry: z.array(Coordinate.nullable()).default([]),
      tags: Tags,
    }),
  ),
});

/** Runnable ways with their names tidied; a way whose geometry is incomplete is skipped rather than guessed at. */
export const parseWays = (body: unknown): OsmWay[] =>
  Ways.parse(body).elements.flatMap((element) => {
    const geometry = element.geometry.filter((point) => point !== null);
    return element.type === "way" &&
      isRunnable(element.tags) &&
      geometry.length > 1 &&
      geometry.length === element.nodes.length
      ? [
          {
            id: element.id,
            name: (element.tags.name ?? "").trim().replace(/\s+/g, " "),
            nodes: element.nodes,
            geometry: geometry.map(position),
          },
        ]
      : [];
  });
