import { timingSafeEqual } from "node:crypto";

/** Long enough to log in to Strava and approve; short enough that a leaked state is soon useless. */
const STATE_TTL_MS = 15 * 60_000;

/**
 * The OAuth `state` parameter, binding a Strava authorisation round trip to the login that started it, so a forged
 * callback cannot attach someone else's Strava account (CSRF). It is signed rather than stored, with a key that lives
 * only in this process: a restart voids the states in flight, which only means pressing Connect again.
 */
export type OAuthStates = {
  readonly issue: (login: string, now: Date) => string;
  readonly verify: (state: string, login: string, now: Date) => boolean;
};

export const createOAuthStates = (key: Uint8Array = crypto.getRandomValues(new Uint8Array(32))): OAuthStates => {
  const sign = (payload: string) => new Bun.CryptoHasher("sha256", key).update(payload).digest("base64url");
  const payloadOf = (login: string, expires: string, nonce: string) => `${login}\n${expires}\n${nonce}`;

  return {
    issue: (login, now) => {
      const expires = String(now.getTime() + STATE_TTL_MS);
      const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64url");
      return `${expires}.${nonce}.${sign(payloadOf(login, expires, nonce))}`;
    },
    verify: (state, login, now) => {
      const [expires = "", nonce = "", signature = ""] = state.split(".");
      const expected = Buffer.from(sign(payloadOf(login, expires, nonce)));
      const given = Buffer.from(signature);
      return given.length === expected.length && timingSafeEqual(given, expected) && Number(expires) > now.getTime();
    },
  };
};
