import { and, desc, inArray, isNotNull } from "drizzle-orm";
import type { Question, StoredAnswer } from "../contract";
import type { FlatsDb } from "./db";
import type { Extraction } from "./extractor";
import type { ParsedListing } from "./portals/listing";
import { fingerprint } from "./questions";
import { listings, readings } from "./schema";

/** The listing page Jev reads for a property: its most recently parsed one. */
export type ListingText = { readonly parsed: ParsedListing; readonly fingerprint: string };

/** Each property's `ListingText`, by property id; a property whose pages are all unread has none. */
export const latestTexts = async (
  db: FlatsDb,
  propertyIds: readonly string[],
): Promise<ReadonlyMap<string, ListingText>> => {
  if (propertyIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectDistinctOn([listings.propertyId], {
      propertyId: listings.propertyId,
      parsed: listings.parsed,
      fingerprint: listings.textFingerprint,
    })
    .from(listings)
    .where(and(inArray(listings.propertyId, [...propertyIds]), isNotNull(listings.parsed)))
    .orderBy(listings.propertyId, desc(listings.parsedAt));
  return new Map(
    rows.flatMap(({ propertyId, parsed, fingerprint }) =>
      parsed === null || fingerprint === null ? [] : [[propertyId, { parsed, fingerprint }]],
    ),
  );
};

/** Every answer Jev has given about each of the texts, by text fingerprint. */
export const readingsOf = async (
  db: FlatsDb,
  textFingerprints: readonly string[],
): Promise<ReadonlyMap<string, readonly StoredAnswer[]>> => {
  if (textFingerprints.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      text: readings.textFingerprint,
      fingerprint: readings.questionFingerprint,
      answer: readings.answer,
    })
    .from(readings)
    .where(inArray(readings.textFingerprint, [...new Set(textFingerprints)]));
  return rows.reduce(
    (byText, { text, fingerprint, answer }) => byText.set(text, [...(byText.get(text) ?? []), { fingerprint, answer }]),
    new Map<string, readonly StoredAnswer[]>(),
  );
};

/** Keeps what Jev answered to `questions` about the text, returning the answers as stored. */
export const recordReadings = async (
  db: FlatsDb,
  text: ListingText,
  questions: readonly Question[],
  extraction: Extraction,
): Promise<StoredAnswer[]> => {
  const fresh = questions.flatMap((question) => {
    const answer = extraction.answers.get(question.key);
    return answer === undefined ? [] : [{ fingerprint: fingerprint(question), answer }];
  });
  if (fresh.length > 0) {
    await db
      .insert(readings)
      .values(
        fresh.map(({ fingerprint, answer }) => ({
          textFingerprint: text.fingerprint,
          questionFingerprint: fingerprint,
          answer,
          model: extraction.model,
        })),
      )
      // Two questions asked in the same words, or two askers at once, read the same thing.
      .onConflictDoNothing();
  }
  return fresh;
};
