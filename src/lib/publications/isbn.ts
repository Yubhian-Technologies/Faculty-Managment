/**
 * ISBN-10 and ISBN-13, checked properly.
 *
 * A shape test alone accepts "978-0-306-40615-8", which is a real ISBN's digits
 * with the wrong check digit - the one kind of typo an ISBN is designed to
 * catch. So both lengths are verified by their own checksum, not by a regex.
 *
 * Hyphens and spaces are FORMATTING, not data: the grouping varies by
 * registration group and publisher (0-306-40615-2 against 978-93-5000-000-0),
 * so no single hyphen pattern can be demanded. They are stripped before
 * checking and the value is stored and displayed exactly as it was typed.
 */

/** Hyphens and any whitespace, which carry no meaning in an ISBN. */
const FORMATTING = /[\s-]+/g;

/** The value with its formatting removed, upper-cased so a trailing "x" counts. */
export function normalizeIsbn(raw: string | null | undefined): string {
  return (raw ?? "").replace(FORMATTING, "").toUpperCase();
}

/**
 * Ten characters: nine digits and a check digit that may be X, standing for 10.
 * Valid when the digits weighted 10..1 sum to a multiple of 11.
 */
function isValidIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const char = value[i];
    sum += (char === "X" ? 10 : char.charCodeAt(0) - 48) * (10 - i);
  }
  return sum % 11 === 0;
}

/**
 * Thirteen digits beginning 978 or 979 (the only prefixes assigned to books),
 * valid when the digits weighted 1,3,1,3... sum to a multiple of 10.
 */
function isValidIsbn13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  if (!value.startsWith("978") && !value.startsWith("979")) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += (value.charCodeAt(i) - 48) * (i % 2 === 0 ? 1 : 3);
  return sum % 10 === 0;
}

/** Whether this is a real ISBN-10 or ISBN-13, however it was punctuated. */
export function isValidIsbn(raw: string | null | undefined): boolean {
  const value = normalizeIsbn(raw);
  return isValidIsbn10(value) || isValidIsbn13(value);
}

/** The one message every ISBN field shows, so they can't drift apart. */
export const ISBN_ERROR = "Enter a valid ISBN-10 or ISBN-13.";

/**
 * Which publication types carry an ISBN, and whether it is compulsory.
 *
 * A published textbook always has one. Conference proceedings often do not, and
 * a book chapter's ISBN is the parent book's, which the author may not have to
 * hand - so for those it is optional, and only checked when something is typed.
 */
export function isIsbnRequired(type: string): boolean {
  return type === "TEXT_BOOK";
}

export function isIsbnUsed(type: string): boolean {
  return type === "TEXT_BOOK" || type === "CONFERENCE" || type === "BOOK_CHAPTER";
}

/**
 * The ISBN rule for one publication, as a message or null when it is fine.
 * Shared by the form and both write routes so they cannot disagree.
 */
export function checkIsbn(type: string, raw: string | null | undefined): string | null {
  const typed = (raw ?? "").trim();
  if (!typed) return isIsbnRequired(type) ? "ISBN Number is required for a Text Book." : null;
  if (!isIsbnUsed(type)) return null;
  return isValidIsbn(typed) ? null : ISBN_ERROR;
}
