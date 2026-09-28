import { z } from "zod";

export type FlatsConfig = {
  /** Commute times are only computed when TfL is configured. */
  readonly tflApiKey: string | null;
};

/** Compose passes an unset optional secret through as an empty string, so blank means unset. */
const FlatsEnv = z.object({ TFL_API_KEY: z.string().trim().optional() });

export const parseFlatsConfig = (env: Readonly<Record<string, string | undefined>>): FlatsConfig => {
  const result = FlatsEnv.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid flats environment:\n${z.prettifyError(result.error)}`);
  }
  return { tflApiKey: result.data.TFL_API_KEY || null };
};
