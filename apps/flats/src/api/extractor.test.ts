import { describe, expect, test } from "bun:test";
import { PermanentJobError } from "@apps/core";
import { createJevExtractor } from "./extractor";
import type { ListingState, Question } from "./questions";

/** A `fetch` that answers every request with `response`, recording the requests' bodies and headers. */
const sendingBack = (response: () => Response) => {
  const requested: { url: string; headers: Headers; body: unknown }[] = [];
  const send = (async (input: string | URL | Request, init?: RequestInit) => {
    requested.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return response();
  }) as typeof fetch;
  return { send, requested };
};

const failureOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

const state: ListingState = { property_type: "Flat", key_features: ["Balcony"], description: "A bright flat." };
const signal = new AbortController().signal;

const auction: Question = {
  key: "auction",
  kind: "exclusion",
  label: "Auction",
  reason: "Auction",
  instructions: "Auction?",
};
const parking: Question = {
  key: "parking",
  kind: "feature",
  label: "Parking",
  points: 1,
  instructions: "Parking?",
  criteria: { yes: "Its own space", no: "No space" },
};
const outdoor: Question = {
  key: "outdoor",
  kind: "choice",
  label: "Outdoor space",
  instructions: "Outdoor space?",
  options: {
    balcony: { label: "Balcony", description: "A balcony", points: 2 },
    none: { label: "None", description: "None", points: 0 },
  },
};
const light: Question = {
  key: "light",
  kind: "score",
  label: "Light",
  instructions: "How light?",
  levels: [
    { label: "Dark", description: "Dark", points: 0 },
    { label: "Some", description: "Some", points: 1 },
    { label: "Bright", description: "Bright", points: 2 },
  ],
};

const answered = Response.json({
  model: "jev-1.13.0",
  answers: {
    auction: { type: "noul", noul: 0.01 },
    parking: { type: "noul", noul: 0.97 },
    outdoor: { type: "choice", choice: "balcony", probabilities: { balcony: 0.9, none: 0.1 }, confidence: 0.8 },
    light: {
      type: "score",
      score: 1.8,
      legend: { "0": "Dark", "1": "Some", "2": "Bright" },
      probabilities: { "2": 0.8, "0": 0, "1": 0.2 },
      confidence: 0.7,
    },
  },
  usage: { input_tokens: 300, output_tokens: 40 },
});

describe("Jev extractor", () => {
  test("asks every question about the listing in one call", async () => {
    const { send, requested } = sendingBack(() => answered.clone());

    await createJevExtractor("secret", send).answer(state, [auction, parking, outdoor, light], signal);

    expect(requested).toHaveLength(1);
    const [request] = requested;
    expect(request?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(request?.headers.get("Authorization")).toBe("Bearer secret");
    expect(request?.body).toEqual({
      model: "jev-latest",
      state,
      questions: {
        auction: { type: "noul", instructions: "Auction?" },
        parking: { type: "noul", instructions: "Parking?", criteria: { true: "Its own space", false: "No space" } },
        outdoor: { type: "choice", instructions: "Outdoor space?", criteria: { balcony: "A balcony", none: "None" } },
        light: { type: "score", instructions: "How light?", criteria: ["Dark", "Some", "Bright"] },
      },
    });
  });

  test("reads each answer, with a score's levels in the question's order", async () => {
    const { send } = sendingBack(() => answered.clone());

    const extraction = await createJevExtractor("k", send).answer(state, [auction, parking, outdoor, light], signal);

    expect(extraction.model).toBe("jev-1.13.0");
    expect(Object.fromEntries(extraction.answers)).toEqual({
      auction: { kind: "noul", yes: 0.01 },
      parking: { kind: "noul", yes: 0.97 },
      outdoor: { kind: "choice", probabilities: { balcony: 0.9, none: 0.1 } },
      light: { kind: "score", probabilities: [0, 0.2, 0.8] },
    });
  });

  test("fails when a question comes back unanswered or as the wrong type", async () => {
    const { send } = sendingBack(() =>
      Response.json({ model: "jev-1.13.0", answers: { parking: { type: "noul", noul: 0.5 } } }),
    );
    const failure = await failureOf(createJevExtractor("k", send).answer(state, [parking, outdoor], signal));
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain("outdoor");

    const mistyped = sendingBack(() =>
      Response.json({ model: "jev-1.13.0", answers: { outdoor: { type: "noul", noul: 0.5 } } }),
    );
    expect(await failureOf(createJevExtractor("k", mistyped.send).answer(state, [outdoor], signal))).toBeInstanceOf(
      Error,
    );
  });

  test("leaves rate limits and overload to the job's retries", async () => {
    for (const status of [429, 500, 529]) {
      const { send } = sendingBack(() => new Response("", { status }));
      const failure = await failureOf(createJevExtractor("k", send).answer(state, [parking], signal));
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(PermanentJobError);
    }
  });

  test("gives up on a refused key or a malformed question", async () => {
    for (const status of [401, 422]) {
      const { send } = sendingBack(() => Response.json({ detail: "nope" }, { status }));
      expect(await failureOf(createJevExtractor("k", send).answer(state, [parking], signal))).toBeInstanceOf(
        PermanentJobError,
      );
    }
  });
});
