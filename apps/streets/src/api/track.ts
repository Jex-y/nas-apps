import { z } from "zod";
import { haversineMetres, type LatLon } from "./geo";

/** An activity's GPS as Strava's `latlng` and `time` streams give it: positions, and seconds since the start. */
export type Track = {
  readonly latlng: readonly LatLon[];
  readonly time: readonly number[];
};

const StoredTrack = z.object({
  latlng: z.array(z.tuple([z.number(), z.number()])),
  time: z.array(z.number()),
});

/** Tracks are kept gzipped in blob storage so matching can be re-run when the rules or the streets change. */
export const encodeTrack = (track: Track): Uint8Array<ArrayBuffer> => Bun.gzipSync(JSON.stringify(track));

export const decodeTrack = (data: Uint8Array<ArrayBuffer>): Track =>
  StoredTrack.parse(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(data))));

export const trackKey = (activityId: string): string => `tracks/${activityId}.json.gz`;

export const trackDistance = (points: readonly LatLon[]): number =>
  points.reduce((total, point, index) => {
    const previous = points[index - 1];
    return previous === undefined ? total : total + haversineMetres(previous, point);
  }, 0);

export class GpxError extends Error {}

export type ParsedGpx = {
  readonly name: string;
  readonly sportType: string;
  readonly startAt: Date;
  readonly distanceMetres: number;
  readonly track: Track;
};

/** Strava's export writes its activity type into `<type>`, as a word or as a Garmin-style number. */
const SPORT_TYPES: Readonly<Record<string, string>> = {
  running: "Run",
  run: "Run",
  "9": "Run",
  trail_running: "TrailRun",
  walking: "Walk",
  walk: "Walk",
  "10": "Walk",
  hiking: "Hike",
  hike: "Hike",
  "4": "Hike",
};

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const decodeXml = (text: string): string =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (entity, name: string) =>
      name.startsWith("#x") || name.startsWith("#X")
        ? String.fromCodePoint(Number.parseInt(name.slice(2), 16))
        : name.startsWith("#")
          ? String.fromCodePoint(Number(name.slice(1)))
          : (ENTITIES[name] ?? entity),
    )
    .trim();

const TRACK_POINT = /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/g;
const attribute = (attributes: string, name: string): number =>
  Number(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`).exec(attributes)?.[1] ?? Number.NaN);
const element = (xml: string, name: string): string | null => {
  const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
  return match?.[1] === undefined ? null : decodeXml(match[1]);
};

/**
 * Reads the track points of a GPX file, from Strava's bulk export or any other device. A deliberately small
 * reader, as GPX is simple and regular: points without a valid position are skipped, and a file with none fails.
 */
export const parseGpx = (xml: string, fallback: { readonly name: string; readonly startAt: Date }): ParsedGpx => {
  const points: { readonly position: LatLon; readonly at: number | null }[] = [];
  for (const [, attributes = "", body = ""] of xml.matchAll(TRACK_POINT)) {
    const lat = attribute(attributes, "lat");
    const lon = attribute(attributes, "lon");
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      const time = element(body, "time");
      const at = time === null ? Number.NaN : Date.parse(time);
      points.push({ position: [lat, lon], at: Number.isNaN(at) ? null : at });
    }
  }
  if (points.length === 0) {
    throw new GpxError("No track points");
  }

  const trackXml = /<trk\b[\s\S]*$/.exec(xml)?.[0] ?? "";
  const metadataTime = Date.parse(element(xml.split(/<trk\b/)[0] ?? "", "time") ?? "");
  const firstTime = points.find((point) => point.at !== null)?.at;
  const start = firstTime ?? (Number.isNaN(metadataTime) ? fallback.startAt.getTime() : metadataTime);
  const latlng = points.map((point) => point.position);
  const type = element(trackXml, "type")?.toLowerCase() ?? "";

  return {
    name: element(trackXml, "name") || fallback.name,
    sportType: SPORT_TYPES[type] ?? "Run",
    startAt: new Date(start),
    distanceMetres: trackDistance(latlng),
    track: {
      latlng,
      time: points.map((point) => (point.at === null ? 0 : Math.max(0, Math.round((point.at - start) / 1000)))),
    },
  };
};
