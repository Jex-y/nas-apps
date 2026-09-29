import { Requirements } from "../../../../contract";

export type Draft =
  | { readonly kind: "valid"; readonly requirements: Requirements }
  | { readonly kind: "invalid"; readonly problems: readonly string[] };

/** Reads the editor's text as a requirements document, or says what is wrong with it. */
export const parseDraft = (text: string): Draft => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { kind: "invalid", problems: [error instanceof Error ? error.message : String(error)] };
  }
  const result = Requirements.safeParse(json);
  return result.success
    ? { kind: "valid", requirements: result.data }
    : {
        kind: "invalid",
        problems: result.error.issues.map((issue) =>
          issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`,
        ),
      };
};

export const formatDocument = (requirements: Requirements): string => JSON.stringify(requirements, null, 2);
