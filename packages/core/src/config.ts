import { z } from "zod";
import type { IdentityMode } from "./identity";

export type DatabaseConfig = {
  readonly hostname: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly database: string;
};

export type ServerConfig = {
  readonly port: number;
  readonly development: boolean;
  readonly database: DatabaseConfig;
  readonly identity: IdentityMode;
};

type Env = Readonly<Record<string, string | undefined>>;

const DatabaseEnv = z.object({
  PGHOST: z.string().min(1),
  PGPORT: z.coerce.number().int().positive().default(5432),
  PGUSER: z.string().min(1),
  PGPASSWORD: z.string().min(1),
  PGDATABASE: z.string().min(1),
});

const ServerEnv = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    DEV_USER: z.string().min(1).optional(),
  })
  .refine((env) => env.DEV_USER === undefined || env.NODE_ENV === "development", {
    message: "DEV_USER is only allowed when NODE_ENV=development",
    path: ["DEV_USER"],
  });

const parse = <S extends z.ZodType>(schema: S, env: Env): z.infer<S> => {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
};

export const parseDatabaseConfig = (env: Env): DatabaseConfig => {
  const db = parse(DatabaseEnv, env);
  return {
    hostname: db.PGHOST,
    port: db.PGPORT,
    username: db.PGUSER,
    password: db.PGPASSWORD,
    database: db.PGDATABASE,
  };
};

export const parseServerConfig = (env: Env): ServerConfig => {
  const server = parse(ServerEnv, env);
  return {
    port: server.PORT,
    development: server.NODE_ENV === "development",
    database: parseDatabaseConfig(env),
    identity:
      server.DEV_USER === undefined ? { kind: "tailscale" } : { kind: "fixed", viewer: { login: server.DEV_USER } },
  };
};
