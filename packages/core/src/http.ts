import { z } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const parseBody = async <S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> => {
  const body: unknown = await request.json().catch(() => {
    throw new HttpError(400, "Request body must be JSON");
  });
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(400, z.prettifyError(result.error));
  }
  return result.data;
};

/** The query string, as `schema` reads it; a bad one is the client's mistake, so a 400. */
export const parseQuery = <S extends z.ZodType>(request: Request, schema: S): z.infer<S> => {
  const result = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!result.success) {
    throw new HttpError(400, z.prettifyError(result.error));
  }
  return result.data;
};

export const parseParam = <S extends z.ZodType>(value: string, schema: S): z.infer<S> => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(404, "Not found");
  }
  return result.data;
};

export const errorResponse = (error: unknown): Response => {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
};
