import { describe, expect, test } from "bun:test";
import { createOAuthStates } from "./oauth-state";

const NOW = new Date("2026-09-28T12:00:00Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe("OAuth state", () => {
  const states = createOAuthStates();

  test("verifies for the login that started it, until it expires", () => {
    const state = states.issue("ed@example.com", NOW);
    expect(states.verify(state, "ed@example.com", later(14))).toBe(true);
    expect(states.verify(state, "ed@example.com", later(16))).toBe(false);
  });

  test("refuses another login, a tampered state, and another server's", () => {
    const state = states.issue("ed@example.com", NOW);
    const [expires, nonce, signature] = state.split(".");
    expect(states.verify(state, "mallory@example.com", NOW)).toBe(false);
    expect(states.verify(`${Number(expires) + 3_600_000}.${nonce}.${signature}`, "ed@example.com", NOW)).toBe(false);
    expect(states.verify("", "ed@example.com", NOW)).toBe(false);
    expect(createOAuthStates().verify(state, "ed@example.com", NOW)).toBe(false);
  });

  test("is different every time", () => {
    expect(states.issue("ed@example.com", NOW)).not.toBe(states.issue("ed@example.com", NOW));
  });
});
