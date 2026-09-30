import { useEffect, useState } from "react";
import type { Question } from "../../../../contract";
import { fingerprintInBrowser } from "../../../../scoring";

/**
 * Each question's fingerprint by key: `null` until the first hashing finishes, then the last result while the next
 * one runs, so the ranking does not flicker as the wording is typed.
 */
export const useFingerprints = (questions: readonly Question[]): ReadonlyMap<string, string> | null => {
  const [prints, setPrints] = useState<ReadonlyMap<string, string> | null>(null);

  useEffect(() => {
    let current = true;
    void Promise.all(
      questions.map(async (question) => [question.key, await fingerprintInBrowser(question)] as const),
    ).then((entries) => {
      if (current) {
        setPrints(new Map(entries));
      }
    });
    return () => {
      current = false;
    };
  }, [questions]);

  return prints;
};
