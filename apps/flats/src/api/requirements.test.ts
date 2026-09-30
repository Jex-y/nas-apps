import { describe, expect, test } from "bun:test";
import { Requirements } from "../contract";
import { DEFAULT_REQUIREMENTS } from "./requirements";

describe("requirements documents", () => {
  test("the defaults are a valid document", () => {
    expect(Requirements.parse(DEFAULT_REQUIREMENTS)).toEqual(DEFAULT_REQUIREMENTS);
  });

  test("refuse a misspelt field rather than ignoring it", () => {
    const [first, ...rest] = DEFAULT_REQUIREMENTS.questions;
    const misspelt = { ...DEFAULT_REQUIREMENTS, questions: [{ ...first, pionts: 2 }, ...rest] };

    expect(Requirements.safeParse(misspelt).success).toBe(false);
  });

  test("refuse two questions with one key", () => {
    const [first] = DEFAULT_REQUIREMENTS.questions;
    const duplicated = { ...DEFAULT_REQUIREMENTS, questions: [first, first] };

    expect(Requirements.safeParse(duplicated).error?.issues[0]?.message).toBe("Question keys must be unique");
  });
});
