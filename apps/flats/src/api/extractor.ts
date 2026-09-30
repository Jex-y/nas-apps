import { PermanentJobError } from "@apps/core";
import { z } from "zod";
import type { Answer, Question } from "../contract";
import { prompt } from "../scoring";
import type { ListingState } from "./questions";

export type Extraction = {
  /** The versioned model that answered, e.g. `jev-1.13.0`. */
  readonly model: string;
  /** One answer per question asked, by question key. */
  readonly answers: ReadonlyMap<string, Answer>;
};

export type FeatureExtractor = {
  /**
   * Answers every question from the listing's text in one call. Throws `PermanentJobError` when the request itself is
   * refused (bad key, malformed question), which retrying cannot fix.
   */
  readonly answer: (state: ListingState, questions: readonly Question[], signal: AbortSignal) => Promise<Extraction>;
};

const Probabilities = z.record(z.string(), z.number());

const SystemOneResponse = z.object({
  model: z.string(),
  answers: z.record(
    z.string(),
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("noul"), noul: z.number() }),
      z.object({ type: z.literal("choice"), probabilities: Probabilities }),
      z.object({ type: z.literal("score"), probabilities: Probabilities }),
    ]),
  ),
});
type WireAnswer = z.infer<typeof SystemOneResponse>["answers"][string];

const toAnswer = (question: Question, wire: WireAnswer | undefined): Answer => {
  switch (question.kind) {
    case "exclusion":
    case "feature":
      if (wire?.type === "noul") {
        return { kind: "noul", yes: wire.noul };
      }
      break;
    case "choice":
      if (wire?.type === "choice") {
        return { kind: "choice", probabilities: wire.probabilities };
      }
      break;
    case "score":
      if (wire?.type === "score") {
        const { probabilities } = wire;
        return { kind: "score", probabilities: question.levels.map((_, level) => probabilities[String(level)] ?? 0) };
      }
      break;
  }
  throw new Error(`Jev answered ${question.kind} question ${question.key} with ${wire?.type ?? "nothing"}`);
};

/** TypeSafe's System One API, answered by the latest Jev. */
export const createJevExtractor = (apiKey: string, send: typeof fetch = fetch): FeatureExtractor => ({
  answer: async (state, questions, signal) => {
    const response = await send("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "jev-latest",
        state,
        questions: Object.fromEntries(questions.map((question) => [question.key, prompt(question)])),
      }),
      signal,
    });
    if (response.status === 429 || response.status >= 500) {
      throw new Error(`Jev failed: ${response.status}`);
    }
    if (!response.ok) {
      throw new PermanentJobError(`Jev refused the request: ${response.status} ${await response.text()}`);
    }
    const { model, answers } = SystemOneResponse.parse(await response.json());
    return {
      model,
      answers: new Map(questions.map((question) => [question.key, toAnswer(question, answers[question.key])])),
    };
  },
});
