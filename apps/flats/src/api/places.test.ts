import { describe, expect, test } from "bun:test";
import { PermanentJobError } from "@apps/core";
import { createPostcodesIo, createTflPlanner, nextTuesday } from "./places";

const journey = await Bun.file(new URL("../../test/fixtures/tfl/journey.json", import.meta.url)).text();

/** A `fetch` that answers every request with `response`, recording the URLs asked for. */
const sendingBack = (response: () => Response) => {
  const requested: URL[] = [];
  const send = (async (input: string | URL | Request) => {
    requested.push(new URL(input instanceof Request ? input.url : input));
    return response();
  }) as typeof fetch;
  return { send, requested };
};

const home = { latitude: 51.476311, longitude: -0.324446 };
const office = { latitude: 51.5162, longitude: -0.1117 };
const tuesdayNine = { date: "20260929", time: "0900" };
const signal = new AbortController().signal;

const failureOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

describe("TfL journey planner", () => {
  test("asks for journeys arriving by the time and takes the fastest", async () => {
    const { send, requested } = sendingBack(() => new Response(journey));

    const minutes = await createTflPlanner("secret", send).fastestMinutes(home, office, tuesdayNine, signal);

    expect(minutes).toBe(73);
    const [url] = requested;
    expect(url?.pathname).toBe("/Journey/JourneyResults/51.476311,-0.324446/to/51.5162,-0.1117");
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      date: "20260929",
      time: "0900",
      timeIs: "Arriving",
      journeyPreference: "LeastTime",
      app_key: "secret",
    });
  });

  test("reads no route from a 404 or an empty result", async () => {
    const notFound = sendingBack(() => new Response("{}", { status: 404 }));
    const empty = sendingBack(() => Response.json({ journeys: [] }));

    expect(await createTflPlanner("k", notFound.send).fastestMinutes(home, office, tuesdayNine, signal)).toBeNull();
    expect(await createTflPlanner("k", empty.send).fastestMinutes(home, office, tuesdayNine, signal)).toBeNull();
  });

  test("leaves rate limits and outages to the job's retries", async () => {
    for (const status of [429, 503]) {
      const { send } = sendingBack(() => new Response("", { status }));
      const failure = await failureOf(createTflPlanner("k", send).fastestMinutes(home, office, tuesdayNine, signal));
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(PermanentJobError);
    }
  });

  test("gives up on a request TfL refuses", async () => {
    const { send } = sendingBack(() => new Response("", { status: 403 }));
    const failure = await failureOf(createTflPlanner("wrong", send).fastestMinutes(home, office, tuesdayNine, signal));
    expect(failure).toBeInstanceOf(PermanentJobError);
  });
});

describe("postcodes.io geocoder", () => {
  test("normalises a postcode and finds its centre", async () => {
    const { send, requested } = sendingBack(() =>
      Response.json({ result: { postcode: "WC2A 1QS", latitude: 51.5162, longitude: -0.1117 } }),
    );

    expect(await createPostcodesIo(send).postcode(" wc2a1qs ")).toEqual({ postcode: "WC2A 1QS", location: office });
    expect(requested[0]?.pathname).toBe("/postcodes/wc2a1qs");
  });

  test("reads an unknown postcode as null", async () => {
    const { send } = sendingBack(() => new Response("{}", { status: 404 }));
    expect(await createPostcodesIo(send).postcode("ZZ1 1ZZ")).toBeNull();
  });
});

describe("next Tuesday", () => {
  test("is the coming Tuesday, at the arrive-by time", () => {
    expect(nextTuesday(new Date("2026-09-21T11:00:00Z"), "08:45")).toEqual({ date: "20260922", time: "0845" });
    expect(nextTuesday(new Date("2026-09-24T11:00:00Z"), "09:00").date).toBe("20260929");
  });

  test("on a Tuesday is the Tuesday after", () => {
    expect(nextTuesday(new Date("2026-09-29T07:00:00Z"), "09:00").date).toBe("20261006");
  });

  test("goes by the London date, not the UTC one", () => {
    // 23:30 UTC on a Monday is already Tuesday in British Summer Time, but still Monday in GMT.
    expect(nextTuesday(new Date("2026-09-28T23:30:00Z"), "09:00").date).toBe("20261006");
    expect(nextTuesday(new Date("2026-12-07T23:30:00Z"), "09:00").date).toBe("20261208");
  });

  test("steps across the clocks changing", () => {
    // Late on the Saturday before the clocks go back (25 October 2026) and forward (28 March 2027).
    expect(nextTuesday(new Date("2026-10-24T22:30:00Z"), "09:00").date).toBe("20261027");
    expect(nextTuesday(new Date("2027-03-27T23:30:00Z"), "09:00").date).toBe("20270330");
  });
});
