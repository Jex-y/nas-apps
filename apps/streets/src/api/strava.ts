import { PermanentJobError } from "@apps/core";
import { z } from "zod";
import type { StravaCredentials } from "./config";
import type { Track } from "./track";

const STRAVA = "https://www.strava.com";
/** Private ("Only you") activities are runs too. */
export const STRAVA_SCOPE = "read,activity:read_all";

export type StravaResult<T> =
  | { readonly kind: "ok"; readonly body: T }
  /** Over a rate limit; nothing will succeed before `retryAt`, so reschedule rather than retry. */
  | { readonly kind: "limited"; readonly retryAt: Date }
  /** The athlete revoked access, or the refresh token no longer works; only reconnecting can fix it. */
  | { readonly kind: "unauthorized" }
  /** The activity was deleted on Strava. */
  | { readonly kind: "gone" };

export type StravaTokens = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
};

export type StravaGrant = StravaTokens & {
  readonly athlete: { readonly id: number; readonly name: string };
};

export type StravaActivity = {
  readonly id: number;
  readonly name: string;
  readonly sportType: string;
  readonly startAt: Date;
  readonly distanceMetres: number;
  /** Entered by hand, so it has no GPS to fetch. */
  readonly manual: boolean;
};

/** The Strava API; tests swap in a fake. */
export type StravaApi = {
  readonly authorizeUrl: (redirectUri: string, state: string) => string;
  /** Throws when Strava refuses the code, which only a fresh authorisation can fix. */
  readonly exchangeCode: (code: string) => Promise<StravaGrant>;
  readonly refresh: (refreshToken: string) => Promise<StravaResult<StravaTokens>>;
  readonly deauthorize: (accessToken: string) => Promise<void>;
  /** Newest first before `before`, or oldest first after `after`; both epoch seconds. */
  readonly activities: (
    accessToken: string,
    page: { readonly before?: number; readonly after?: number; readonly perPage: number },
  ) => Promise<StravaResult<StravaActivity[]>>;
  /** `null` when the activity has no GPS, e.g. on a treadmill. */
  readonly track: (accessToken: string, activityId: number) => Promise<StravaResult<Track | null>>;
};

const TokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_at: z.number(),
});

const GrantResponse = TokenResponse.extend({
  athlete: z.object({ id: z.number(), firstname: z.string().nullish(), lastname: z.string().nullish() }),
});

const ActivitiesResponse = z.array(
  z.object({
    id: z.number(),
    name: z.string(),
    sport_type: z.string(),
    start_date: z.iso.datetime(),
    distance: z.number(),
    manual: z.boolean().default(false),
  }),
);

const StreamsResponse = z.object({
  latlng: z.object({ data: z.array(z.tuple([z.number(), z.number()])) }).optional(),
  time: z.object({ data: z.array(z.number()) }).optional(),
});

const tokens = (body: z.infer<typeof TokenResponse>): StravaTokens => ({
  accessToken: body.access_token,
  refreshToken: body.refresh_token,
  expiresAt: new Date(body.expires_at * 1000),
});

const QUARTER_HOUR_MS = 15 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
/** Waits a little past the reset, so a slightly fast clock here does not land in the old window. */
const RESET_MARGIN_MS = 30_000;

const nextQuarterHour = (now: Date) =>
  new Date(Math.floor(now.getTime() / QUARTER_HOUR_MS) * QUARTER_HOUR_MS + QUARTER_HOUR_MS + RESET_MARGIN_MS);
const nextUtcDay = (now: Date) => new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS + DAY_MS + RESET_MARGIN_MS);

/**
 * When a limit pair ("15-minute,daily", as in `X-RateLimit-Limit` and `X-RateLimit-Usage`) is used up, the time it
 * resets: Strava's short windows start on the quarter hour and its daily one at midnight UTC. `null` while it has room.
 */
export const limitResetAt = (limit: string | null, usage: string | null, now: Date): Date | null => {
  const [shortLimit, dailyLimit] = (limit ?? "").split(",").map(Number);
  const [shortUsed, dailyUsed] = (usage ?? "").split(",").map(Number);
  const spent = (allowed = Number.NaN, used = Number.NaN) => allowed > 0 && used >= allowed;
  if (spent(dailyLimit, dailyUsed)) {
    return nextUtcDay(now);
  }
  return spent(shortLimit, shortUsed) ? nextQuarterHour(now) : null;
};

/** The later of the overall and read limits' resets, or `null` when both have room. */
const resetAt = (headers: Headers, now: Date): Date | null => {
  const resets = [
    limitResetAt(headers.get("X-RateLimit-Limit"), headers.get("X-RateLimit-Usage"), now),
    limitResetAt(headers.get("X-ReadRateLimit-Limit"), headers.get("X-ReadRateLimit-Usage"), now),
  ].filter((reset) => reset !== null);
  return resets.length === 0 ? null : new Date(Math.max(...resets.map((reset) => reset.getTime())));
};

export type StravaApiOptions = StravaCredentials & {
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
};

/**
 * Remembers when the last response said a limit was used up and answers `limited` until then without asking, so a
 * queue of jobs waiting out the limit does not spend the next window's first requests on 429s.
 */
export const createStravaApi = ({
  clientId,
  clientSecret,
  fetch: send = fetch,
  now = () => new Date(),
}: StravaApiOptions): StravaApi => {
  let blockedUntil: Date | null = null;

  const token = async (params: Record<string, string>) =>
    send(`${STRAVA}/api/v3/oauth/token`, {
      method: "POST",
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
    });

  const get = async <T>(accessToken: string, path: string, read: (body: unknown) => T): Promise<StravaResult<T>> => {
    if (blockedUntil !== null && blockedUntil > now()) {
      return { kind: "limited", retryAt: blockedUntil };
    }
    const response = await send(`${STRAVA}/api/v3${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    blockedUntil = resetAt(response.headers, now());
    if (response.status === 429) {
      // A 429 without usage headers still means the short window is spent.
      blockedUntil ??= nextQuarterHour(now());
      return { kind: "limited", retryAt: blockedUntil };
    }
    if (response.status === 401) {
      return { kind: "unauthorized" };
    }
    if (response.status === 404) {
      return { kind: "gone" };
    }
    if (!response.ok) {
      throw new Error(`Strava GET ${path} failed: ${response.status} ${response.statusText}`);
    }
    return { kind: "ok", body: read(await response.json()) };
  };

  return {
    authorizeUrl: (redirectUri, state) =>
      `${STRAVA}/oauth/authorize?${new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        approval_prompt: "auto",
        scope: STRAVA_SCOPE,
        state,
      })}`,
    exchangeCode: async (code) => {
      const response = await token({ code, grant_type: "authorization_code" });
      if (!response.ok) {
        throw new Error(`Strava refused the authorisation code: ${response.status}`);
      }
      const body = GrantResponse.parse(await response.json());
      const name = [body.athlete.firstname, body.athlete.lastname].filter(Boolean).join(" ");
      return { ...tokens(body), athlete: { id: body.athlete.id, name: name || `Athlete ${body.athlete.id}` } };
    },
    refresh: async (refreshToken) => {
      const response = await token({ refresh_token: refreshToken, grant_type: "refresh_token" });
      if (response.status === 400 || response.status === 401) {
        return { kind: "unauthorized" };
      }
      if (response.status === 429) {
        return { kind: "limited", retryAt: resetAt(response.headers, now()) ?? nextQuarterHour(now()) };
      }
      if (!response.ok) {
        throw new Error(`Strava token refresh failed: ${response.status}`);
      }
      return { kind: "ok", body: tokens(TokenResponse.parse(await response.json())) };
    },
    deauthorize: async (accessToken) => {
      await send(`${STRAVA}/oauth/deauthorize`, {
        method: "POST",
        body: new URLSearchParams({ access_token: accessToken }),
      });
    },
    activities: (accessToken, { before, after, perPage }) => {
      const query = new URLSearchParams({ per_page: String(perPage) });
      if (before !== undefined) {
        query.set("before", String(before));
      }
      if (after !== undefined) {
        query.set("after", String(after));
      }
      return get(accessToken, `/athlete/activities?${query}`, (body) =>
        ActivitiesResponse.parse(body).map((activity) => ({
          id: activity.id,
          name: activity.name,
          sportType: activity.sport_type,
          startAt: new Date(activity.start_date),
          distanceMetres: activity.distance,
          manual: activity.manual,
        })),
      );
    },
    track: (accessToken, activityId) =>
      get(accessToken, `/activities/${activityId}/streams?keys=latlng,time&key_by_type=true`, (body) => {
        const { latlng, time } = StreamsResponse.parse(body);
        if (latlng === undefined || latlng.data.length === 0) {
          return null;
        }
        if (time !== undefined && time.data.length !== latlng.data.length) {
          throw new PermanentJobError(`Strava activity ${activityId} has mismatched latlng and time streams`);
        }
        return { latlng: latlng.data, time: time?.data ?? latlng.data.map(() => 0) };
      }),
  };
};
