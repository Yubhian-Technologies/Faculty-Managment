import { describe, expect, it } from "vitest";
import { formatDate, formatDMY, toDate, toDateInputValue } from "./index";

describe("toDate", () => {
  it("converts Date objects directly", () => {
    const d = new Date(1990, 4, 15);
    expect(toDate(d)).toBe(d);
  });

  it("converts Firestore Timestamp with _seconds (Admin SDK)", () => {
    // 1990-05-15T00:00:00.000Z in seconds is 642729600
    const ts = { _seconds: 642729600, _nanoseconds: 0 };
    const d = toDate(ts);
    expect(d).toBeInstanceOf(Date);
    expect(d?.getTime()).toBe(642729600000);
  });

  it("converts Firestore Timestamp with seconds (Client SDK)", () => {
    const ts = { seconds: 642729600, nanoseconds: 0 };
    const d = toDate(ts);
    expect(d).toBeInstanceOf(Date);
    expect(d?.getTime()).toBe(642729600000);
  });

  it("converts ISO date strings", () => {
    const d = toDate("1990-05-15T00:00:00.000Z");
    expect(d).toBeInstanceOf(Date);
    expect(d?.getTime()).toBe(642729600000);
  });

  it("converts DD-MM-YYYY and DD/MM/YYYY date strings", () => {
    const d1 = toDate("15-05-1990");
    expect(d1).toBeInstanceOf(Date);
    expect(d1?.getUTCFullYear()).toBe(1990);
    expect(d1?.getUTCMonth()).toBe(4);
    expect(d1?.getUTCDate()).toBe(15);

    const d2 = toDate("15/05/1990");
    expect(d2).toBeInstanceOf(Date);
    expect(d2?.getUTCFullYear()).toBe(1990);
    expect(d2?.getUTCMonth()).toBe(4);
    expect(d2?.getUTCDate()).toBe(15);
  });

  it("returns null for null, undefined, or empty string", () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate("")).toBeNull();
  });
});

describe("formatDate and toDateInputValue consistency", () => {
  it("formats IST midnight timestamp consistently without day shift", () => {
    // Stored at IST midnight: 1990-05-15 00:00:00 IST = 1990-05-14 18:30:00 UTC
    const istMidnight = new Date("1990-05-14T18:30:00.000Z");
    expect(formatDate(istMidnight)).toBe("15 May 1990");
    expect(toDateInputValue(istMidnight)).toBe("1990-05-15");
  });

  it("formats UTC midnight timestamp consistently", () => {
    // Stored at UTC midnight: 1990-05-15 00:00:00 UTC = 1990-05-15 05:30:00 IST
    const utcMidnight = new Date("1990-05-15T00:00:00.000Z");
    expect(formatDate(utcMidnight)).toBe("15 May 1990");
    expect(toDateInputValue(utcMidnight)).toBe("1990-05-15");
  });

  it("formats Firestore timestamp-like object consistently", () => {
    // 1990-05-14T18:30:00.000Z in seconds
    const secs = Math.floor(new Date("1990-05-14T18:30:00.000Z").getTime() / 1000);
    const tsAdmin = { _seconds: secs, _nanoseconds: 0 };
    const tsClient = { seconds: secs, nanoseconds: 0 };

    expect(formatDate(tsAdmin)).toBe("15 May 1990");
    expect(toDateInputValue(tsAdmin)).toBe("1990-05-15");

    expect(formatDate(tsClient)).toBe("15 May 1990");
    expect(toDateInputValue(tsClient)).toBe("1990-05-15");
  });

  it("formats plain date-only string YYYY-MM-DD consistently", () => {
    expect(formatDate("1990-05-15")).toBe("15 May 1990");
    expect(toDateInputValue("1990-05-15")).toBe("1990-05-15");
  });

  it("formats plain date-only string DD-MM-YYYY and DD/MM/YYYY consistently", () => {
    expect(formatDate("15-05-1990")).toBe("15 May 1990");
    expect(toDateInputValue("15-05-1990")).toBe("1990-05-15");

    expect(formatDate("15/05/1990")).toBe("15 May 1990");
    expect(toDateInputValue("15/05/1990")).toBe("1990-05-15");
  });

  it("handles null and undefined gracefully", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatDate(undefined)).toBe("-");
    expect(toDateInputValue(null)).toBe("");
    expect(toDateInputValue(undefined)).toBe("");
  });
});

describe("formatDMY (DD-MM-YYYY)", () => {
  it("formats IST midnight timestamp without day rollback", () => {
    const istMidnight = new Date("1990-05-14T18:30:00.000Z");
    expect(formatDMY(istMidnight)).toBe("15-05-1990");
  });

  it("formats UTC midnight timestamp consistently", () => {
    const utcMidnight = new Date("1990-05-15T00:00:00.000Z");
    expect(formatDMY(utcMidnight)).toBe("15-05-1990");
  });

  it("formats Firestore timestamp-like objects", () => {
    const secs = Math.floor(new Date("1990-05-14T18:30:00.000Z").getTime() / 1000);
    expect(formatDMY({ _seconds: secs, _nanoseconds: 0 })).toBe("15-05-1990");
    expect(formatDMY({ seconds: secs, nanoseconds: 0 })).toBe("15-05-1990");
  });

  it("formats plain date strings YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY", () => {
    expect(formatDMY("1990-05-15")).toBe("15-05-1990");
    expect(formatDMY("15-05-1990")).toBe("15-05-1990");
    expect(formatDMY("15/05/1990")).toBe("15-05-1990");
    expect(formatDMY("5/5/1990")).toBe("05-05-1990");
  });

  it("preserves 4-digit legacy year strings", () => {
    expect(formatDMY("2018")).toBe("2018");
  });

  it("handles empty, null, and undefined values", () => {
    expect(formatDMY(null)).toBe("");
    expect(formatDMY(undefined)).toBe("");
    expect(formatDMY("")).toBe("");
  });
});
