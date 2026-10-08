import type { Firestore } from "firebase-admin/firestore";
import { checkIsbn, normalizeIsbn } from "@/lib/publications/isbn";

/**
 * The server's half of the ISBN rule: the same format check the form applies,
 * plus the one thing a form cannot do - noticing that another publication
 * already carries this ISBN.
 *
 * Two deliberate choices:
 *
 *  - An UNCHANGED ISBN is never re-judged. Records predating this check hold
 *    values that were never validated ("2134567", a 27-digit string), and
 *    re-checking one on every later save would lock their owner out of editing
 *    anything else on the record. Only a value this save actually changes is
 *    checked - the same rule the faculty photo and student mobile guards follow.
 *
 *  - Duplicates are found by comparing NORMALIZED values across the college's
 *    publications, so "978-0-306-40615-7" and "9780306406157" are recognised as
 *    the same ISBN. The collection is small (169 across every college today) and
 *    this runs only on a write, so a scan is cheaper than carrying a second
 *    stored field that every existing record would be missing anyway.
 */
export async function checkIsbnForSave(
  db: Firestore,
  collegeId: string,
  type: string,
  isbnNumber: string | null | undefined,
  opts: { publicationId?: string; previousIsbn?: string | null } = {}
): Promise<string | null> {
  const normalized = normalizeIsbn(isbnNumber);

  // Untouched: whatever it is, this save is not the one introducing it.
  if (normalized && normalized === normalizeIsbn(opts.previousIsbn)) return null;

  const formatError = checkIsbn(type, isbnNumber);
  if (formatError) return formatError;
  if (!normalized) return null;

  const snap = await db.collection("colleges").doc(collegeId).collection("publications").get();
  const clash = snap.docs.find((d) => {
    if (d.id === opts.publicationId) return false;
    const other = (d.data() as { details?: { isbnNumber?: string } }).details?.isbnNumber;
    return !!other && normalizeIsbn(other) === normalized;
  });
  if (!clash) return null;

  const title = (clash.data() as { title?: string }).title;
  return title
    ? `That ISBN is already recorded for another publication: "${title}".`
    : "That ISBN is already recorded for another publication.";
}
