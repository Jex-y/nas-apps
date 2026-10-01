import { describe, expect, test } from "bun:test";
import { createStravaApi, limitResetAt, STRAVA_SCOPE } from "./strava";

const NOW = new Date("2026-09-28T12:07:00Z");

/** A fetch that answers with the given responses in turn, recording what it was asked. */
const fakeFetch = (...responses: Response[]) => {
  const requests: Request[] = [];
  const send = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push(new Request(input, init));
    const response = responses.shift();
    if (response === undefined) {
      throw new Error("No more responses");
    }
    return response;
  };
  return { send: send as typeof fetch, requests };
};

const limits = (usage: string, readUsage = "0,0") => ({
  "X-RateLimit-Limit": "200,2000",
  "X-RateLimit-Usage": usage,
  "X-ReadRateLimit-Limit": "100,1000",
  "X-ReadRateLimit-Usage": readUsage,
});

const api = (send: typeof fetch) =>
  createStravaApi({ clientId: "123", clientSecret: "shh", fetch: send, now: () => NOW });

describe("rate limits", () => {
  test("a spent 15-minute window resets on the next quarter hour", () => {
    expect(limitResetAt("200,2000", "200,300", NOW)).toEqual(new Date("2026-09-28T12:15:30Z"));
    expect(limitResetAt("200,2000", "199,300", NOW)).toBeNull();
  });

  test("a spent day resets at midnight UTC", () => {
    expect(limitResetAt("200,2000", "10,2000", NOW)).toEqual(new Date("2026-09-29T00:00:30Z"));
  });

  test("tolerates missing headers", () => {
    expect(limitResetAt(null, null, NOW)).toBeNull();
  });

  test("a 429 reports when to retry, and later calls wait for it without asking Strava", async () => {
    const { send, requests } = fakeFetch(new Response("{}", { status: 429, headers: limits("120,300", "100,300") }));
    const strava = api(send);

    const first = await strava.track("token", 1);
    const second = await strava.activities("token", { perPage: 10 });

    const limited = { kind: "limited", retryAt: new Date("2026-09-28T12:15:30Z") } as const;
    expect(first).toEqual(limited);
    expect(second).toEqual(limited);
    expect(requests).toHaveLength(1);
  });

  test("stops before a 429 once a response shows the window spent", async () => {
    const { send, requests } = fakeFetch(
      Response.json(
        { latlng: { data: [[51.5, -0.1]] }, time: { data: [0] } },
        { headers: limits("50,300", "100,300") },
      ),
    );
    const strava = api(send);

    expect(await strava.track("token", 1)).toMatchObject({ kind: "ok" });
    expect(await strava.track("token", 2)).toMatchObject({ kind: "limited" });
    expect(requests).toHaveLength(1);
  });

  test("a 429 without headers waits for the next window", async () => {
    const { send } = fakeFetch(new Response("", { status: 429 }));
    expect(await api(send).track("token", 1)).toEqual({ kind: "limited", retryAt: new Date("2026-09-28T12:15:30Z") });
  });
});

describe("API", () => {
  test("asks to read private activities and passes the state through", () => {
    const url = new URL(api(fetch).authorizeUrl("https://apps.example/streets/api/strava/callback", "abc"));
    expect(url.origin + url.pathname).toBe("https://www.strava.com/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "123",
      scope: STRAVA_SCOPE,
      state: "abc",
      response_type: "code",
      redirect_uri: "https://apps.example/streets/api/strava/callback",
    });
  });

  test("exchanges a code for tokens and the athlete", async () => {
    const { send, requests } = fakeFetch(
      Response.json({
        access_token: "access",
        refresh_token: "refresh",
        expires_at: 1_790_000_000,
        athlete: { id: 42, firstname: "Ed", lastname: "Jex" },
      }),
    );
    expect(await api(send).exchangeCode("code")).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: new Date(1_790_000_000_000),
      athlete: { id: 42, name: "Ed Jex" },
    });
    const body = new URLSearchParams(await requests[0]?.text());
    expect(Object.fromEntries(body)).toEqual({
      client_id: "123",
      client_secret: "shh",
      code: "code",
      grant_type: "authorization_code",
    });
  });

  test("a refused refresh token means reconnecting", async () => {
    const { send } = fakeFetch(Response.json({ message: "Bad Request" }, { status: 400 }));
    expect(await api(send).refresh("stale")).toEqual({ kind: "unauthorized" });
  });

  test("an activity without GPS has no track, and a deleted one is gone", async () => {
    const { send } = fakeFetch(
      Response.json({ time: { data: [0, 1] }, distance: { data: [0, 3] } }),
      new Response("{}", { status: 404 }),
    );
    const strava = api(send);
    expect(await strava.track("token", 1)).toEqual({ kind: "ok", body: null });
    expect(await strava.track("token", 2)).toEqual({ kind: "gone" });
  });

  test("lists activities with their sport type and start", async () => {
    const { send, requests } = fakeFetch(
      Response.json([
        { id: 7, name: "Lunch Run", sport_type: "Run", start_date: "2026-09-27T12:00:00Z", distance: 5012.3 },
      ]),
    );
    expect(await api(send).activities("token", { before: 1_790_000_000, perPage: 200 })).toEqual({
      kind: "ok",
      body: [
        {
          id: 7,
          name: "Lunch Run",
          sportType: "Run",
          startAt: new Date("2026-09-27T12:00:00Z"),
          distanceMetres: 5012.3,
          manual: false,
        },
      ],
    });
    expect(requests[0]?.url).toBe("https://www.strava.com/api/v3/athlete/activities?per_page=200&before=1790000000");
    expect(requests[0]?.headers.get("Authorization")).toBe("Bearer token");
  });
});
