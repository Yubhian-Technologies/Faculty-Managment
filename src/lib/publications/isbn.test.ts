import { describe, expect, it } from "vitest";
import { checkIsbn, ISBN_ERROR, isValidIsbn, normalizeIsbn } from "./isbn";

describe("normalizeIsbn", () => {
  it("drops hyphens and spaces and upper-cases a trailing x", () => {
    expect(normalizeIsbn("0-306-40615-2")).toBe("0306406152");
    expect(normalizeIsbn(" 978 0 306 40615 7 ")).toBe("9780306406157");
    expect(normalizeIsbn("043942089x")).toBe("043942089X");
  });

  it("is empty for nothing", () => {
    expect(normalizeIsbn(undefined)).toBe("");
    expect(normalizeIsbn(null)).toBe("");
    expect(normalizeIsbn("   ")).toBe("");
  });
});

describe("isValidIsbn", () => {
  it("accepts the ISBN-10s", () => {
    expect(isValidIsbn("0-306-40615-2")).toBe(true);
    expect(isValidIsbn("0306406152")).toBe(true);
    // X as the check digit, standing for 10.
    expect(isValidIsbn("0-19-852663-6")).toBe(true);
    expect(isValidIsbn("043942089X")).toBe(true);
    expect(isValidIsbn("043942089x")).toBe(true);
  });

  it("accepts the ISBN-13s, 978 and 979 alike", () => {
    expect(isValidIsbn("978-0-306-40615-7")).toBe(true);
    expect(isValidIsbn("9780306406157")).toBe(true);
    expect(isValidIsbn("979-8-331-51175-3")).toBe(true);
  });

  // The whole reason for a checksum rather than a shape test: these are the
  // right digits with the wrong check digit.
  it("rejects a wrong check digit", () => {
    expect(isValidIsbn("978-0-306-40615-8")).toBe(false);
    expect(isValidIsbn("0-306-40615-3")).toBe(false);
    expect(isValidIsbn("1234567890")).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(isValidIsbn("123-456")).toBe(false);
    expect(isValidIsbn("97803064061")).toBe(false);
    expect(isValidIsbn("97803064061577")).toBe(false);
  });

  it("rejects letters and punctuation that are not formatting", () => {
    expect(isValidIsbn("978-abc-1234567")).toBe(false);
    expect(isValidIsbn("97803064X6157")).toBe(false);
    expect(isValidIsbn("978.0.306.40615.7")).toBe(false);
  });

  // X is the ISBN-10 check digit's stand-in for ten, nowhere else.
  it("rejects an X anywhere but the last position", () => {
    expect(isValidIsbn("X306406152")).toBe(false);
    expect(isValidIsbn("03064X6152")).toBe(false);
  });

  // 13 digits that are not a book.
  it("rejects a 13-digit value with a prefix that is not 978 or 979", () => {
    expect(isValidIsbn("9770306406157")).toBe(false);
  });

  // Any grouping, because the grouping depends on the registration group.
  it("does not demand one hyphen pattern", () => {
    expect(isValidIsbn("9780306406157")).toBe(true);
    expect(isValidIsbn("978-0306406157")).toBe(true);
    expect(isValidIsbn("978-0-3-0-6-4-0-6-1-5-7")).toBe(true);
  });

  it("is false for nothing at all", () => {
    expect(isValidIsbn("")).toBe(false);
    expect(isValidIsbn(undefined)).toBe(false);
  });
});

describe("checkIsbn", () => {
  // Which fields are compulsory is unchanged - this only decides whether what
  // was typed is a real ISBN.
  it("still requires one for a Conference paper and a Book Chapter", () => {
    expect(checkIsbn("CONFERENCE", "")).toBe("ISBN Number is required.");
    expect(checkIsbn("BOOK_CHAPTER", "   ")).toBe("ISBN Number is required.");
  });

  it("still leaves a Text Book's optional", () => {
    expect(checkIsbn("TEXT_BOOK", "")).toBeNull();
  });

  it("checks whatever is typed, whichever type it is", () => {
    expect(checkIsbn("CONFERENCE", "1234567890")).toBe(ISBN_ERROR);
    expect(checkIsbn("CONFERENCE", "978-0-306-40615-7")).toBeNull();
    expect(checkIsbn("BOOK_CHAPTER", "0-306-40615-2")).toBeNull();
    expect(checkIsbn("BOOK_CHAPTER", "978-0-306-40615-8")).toBe(ISBN_ERROR);
    expect(checkIsbn("TEXT_BOOK", "2134567")).toBe(ISBN_ERROR);
    expect(checkIsbn("TEXT_BOOK", "9780306406157")).toBeNull();
  });

  it("says nothing about a type that carries no ISBN", () => {
    expect(checkIsbn("JOURNAL", "")).toBeNull();
    expect(checkIsbn("JOURNAL", "nonsense")).toBeNull();
  });
});
