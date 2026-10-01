import { createPrivateKey, type KeyObject } from "node:crypto";
import { z } from "zod";

export type EnableBankingConfig = {
  readonly appId: string;
  readonly privateKey: KeyObject;
};

export type MoneyConfig = {
  /** Banks can only be linked when Enable Banking is configured. */
  readonly enableBanking: EnableBankingConfig | null;
};

/** Compose passes an unset optional secret through as an empty string, so blank means unset. */
const MoneyEnv = z.object({
  ENABLE_BANKING_APP_ID: z.string().trim().optional(),
  ENABLE_BANKING_PRIVATE_KEY: z.string().trim().optional(),
});

/** The key as PEM, or base64 of the PEM so it fits on one line of an env file. */
const privateKeyOf = (value: string): KeyObject => {
  const pem = value.includes("BEGIN") ? value.replaceAll("\\n", "\n") : Buffer.from(value, "base64").toString("utf8");
  try {
    return createPrivateKey(pem);
  } catch {
    throw new Error("Invalid money environment:\nENABLE_BANKING_PRIVATE_KEY is not a PEM private key or its base64");
  }
};

export const parseMoneyConfig = (env: Readonly<Record<string, string | undefined>>): MoneyConfig => {
  const result = MoneyEnv.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid money environment:\n${z.prettifyError(result.error)}`);
  }
  const [appId, privateKey] = [
    result.data.ENABLE_BANKING_APP_ID || null,
    result.data.ENABLE_BANKING_PRIVATE_KEY || null,
  ];
  if (appId === null && privateKey === null) {
    return { enableBanking: null };
  }
  if (appId === null || privateKey === null) {
    throw new Error(
      "Invalid money environment:\nSet ENABLE_BANKING_APP_ID and ENABLE_BANKING_PRIVATE_KEY together, or neither",
    );
  }
  return { enableBanking: { appId, privateKey: privateKeyOf(privateKey) } };
};
