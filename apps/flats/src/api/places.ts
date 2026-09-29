import { PermanentJobError } from "@apps/core";
import { z } from "zod";

export type Coordinates = {
  readonly latitude: number;
  readonly longitude: number;
};

export type Geocoder = {
  /** Resolves a UK postcode to its normalised form and centre; `null` when it does not exist. */
  readonly postcode: (
    postcode: string,
  ) => Promise<{ readonly postcode: string; readonly location: Coordinates } | null>;
};

const PostcodeResponse = z.object({
  result: z.object({ postcode: z.string(), latitude: z.number(), longitude: z.number() }),
});

export const createPostcodesIo = (send: typeof fetch = fetch): Geocoder => ({
  postcode: async (postcode) => {
    const response = await send(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim())}`);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`postcodes.io failed: ${response.status}`);
    }
    const { result } = PostcodeResponse.parse(await response.json());
    return { postcode: result.postcode, location: { latitude: result.latitude, longitude: result.longitude } };
  },
});

export type ArriveBy = {
  /** London date, `YYYYMMDD`. */
  readonly date: string;
  /** London time, `HHMM`. */
  readonly time: string;
};

export type JourneyPlanner = {
  /**
   * Minutes for the fastest public-transport journey arriving by `arriveBy`; `null` when TfL finds no route.
   * Throws `PermanentJobError` when TfL refuses the request itself (bad key, bad input), which retrying cannot fix.
   */
  readonly fastestMinutes: (
    from: Coordinates,
    to: Coordinates,
    arriveBy: ArriveBy,
    signal: AbortSignal,
  ) => Promise<number | null>;
};

const JourneyResponse = z.object({ journeys: z.array(z.object({ duration: z.number() })) });

const coordinates = ({ latitude, longitude }: Coordinates) => `${latitude},${longitude}`;

export const createTflPlanner = (apiKey: string, send: typeof fetch = fetch): JourneyPlanner => ({
  fastestMinutes: async (from, to, { date, time }, signal) => {
    const url = new URL(`https://api.tfl.gov.uk/Journey/JourneyResults/${coordinates(from)}/to/${coordinates(to)}`);
    url.search = new URLSearchParams({
      date,
      time,
      timeIs: "Arriving",
      journeyPreference: "LeastTime",
      app_key: apiKey,
    }).toString();
    const response = await send(url, { signal });
    if (response.status === 404) {
      return null;
    }
    if (response.status === 429 || response.status >= 500) {
      throw new Error(`TfL journey planner failed: ${response.status}`);
    }
    if (!response.ok) {
      throw new PermanentJobError(`TfL journey planner refused the request: ${response.status}`);
    }
    const { journeys } = JourneyResponse.parse(await response.json());
    return journeys.length === 0 ? null : Math.min(...journeys.map((journey) => journey.duration));
  },
});

const londonParts = (at: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );

const DAY_MS = 24 * 60 * 60_000;

/**
 * The next Tuesday in London, so every commute is priced against the same kind of working day rather than
 * whatever day the job happens to run.
 */
export const nextTuesday = (now: Date, arriveBy: string): ArriveBy => {
  let day = new Date(now.getTime() + DAY_MS);
  while (londonParts(day).weekday !== "Tue") {
    day = new Date(day.getTime() + DAY_MS);
  }
  const { year, month, day: date } = londonParts(day);
  return { date: `${year}${month}${date}`, time: arriveBy.replace(":", "") };
};
