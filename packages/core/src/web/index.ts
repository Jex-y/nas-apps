import type { z } from "zod";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const errorMessage = async (response: Response): Promise<string> => {
  const body: unknown = await response.json().catch(() => undefined);
  return typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
    ? body.error
    : response.statusText;
};

const send = async (url: string, init: RequestInit): Promise<Response> => {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  if (!response.ok) {
    throw new ApiError(response.status, await errorMessage(response));
  }
  return response;
};

/** Parses the response against the app's contract, so a server/client drift fails loudly at the boundary. */
export const requestJson = async <S extends z.ZodType>(
  url: string,
  schema: S,
  init: RequestInit = {},
): Promise<z.infer<S>> => schema.parse(await (await send(url, init)).json());

export const requestEmpty = async (url: string, init: RequestInit = {}): Promise<void> => {
  await send(url, init);
};
