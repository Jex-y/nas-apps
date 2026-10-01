/** The root of every query's key, so one change can refetch all that is on screen. */
export const MONEY_KEY = ["money"] as const;

export const sendJson = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body !== undefined && { body: JSON.stringify(body) }),
});
