import { z } from "zod";

export type StravaCredentials = {
  readonly clientId: string;
  readonly clientSecret: string;
};

export type StreetsConfig = {
  /** Strava import is only offered when a Strava API application is configured; GPX upload works regardless. */
  readonly strava: StravaCredentials | null;
};

/** Compose passes an unset optional secret through as an empty string, so blank means unset. */
const StreetsEnv = z
  .object({
    STRAVA_CLIENT_ID: z.string().trim().optional(),
    STRAVA_CLIENT_SECRET: z.string().trim().optional(),
  })
  .refine((env) => !env.STRAVA_CLIENT_ID === !env.STRAVA_CLIENT_SECRET, {
    message: "Set both STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET, or neither",
  });

export const parseStreetsConfig = (env: Readonly<Record<string, string | undefined>>): StreetsConfig => {
  const result = StreetsEnv.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid streets environment:\n${z.prettifyError(result.error)}`);
  }
  const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET } = result.data;
  return {
    strava:
      STRAVA_CLIENT_ID && STRAVA_CLIENT_SECRET
        ? { clientId: STRAVA_CLIENT_ID, clientSecret: STRAVA_CLIENT_SECRET }
        : null,
  };
};
