import { checkIsbn, normalizeIsbn } from "@/lib/publications/isbn";

/**
 * The server's half of the ISBN rule: the same format check the form applies.
 *
 * An UNCHANGED ISBN is never re-judged. Records predating this check hold
 * values that were never validated ("2134567", a 27-digit string), and
 * re-checking one on every later save would lock their owner out of editing
 * anything else on the record. Only a value this save actually changes is
 * checked - the same rule the faculty photo and student mobile guards follow.
 *
 * There is deliberately NO uniqueness check. An ISBN identifies a BOOK, not a
 * publication record, so the same one is shared by every chapter of an edited
 * volume and by every paper in a conference proceedings - the live data has
 * two such pairs (9783031770814 and 9781728158754, each two different papers
 * from one proceedings). An earlier version of this file refused the second
 * one with "That ISBN is already recorded for another publication", which
 * blocked a Springer LNICST book chapter that was perfectly valid.
 */
export function checkIsbnForSave(
  type: string,
  isbnNumber: string | null | undefined,
  opts: { previousIsbn?: string | null } = {}
): string | null {
  const normalized = normalizeIsbn(isbnNumber);

  // Untouched: whatever it is, this save is not the one introducing it.
  if (normalized && normalized === normalizeIsbn(opts.previousIsbn)) return null;

  return checkIsbn(type, isbnNumber);
}
