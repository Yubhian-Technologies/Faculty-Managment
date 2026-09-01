import { describe, expect, it } from "vitest";
import {
  expandScientificNotation,
  isScientificNotation,
  normalizeDigits,
  matchOption,
  parseYesNoStrict,
  parseWholeNumber,
  isValidEmail,
  RATIFICATION_STATUS_OPTIONS,
  GENDER_OPTIONS,
  BLOOD_GROUP_OPTIONS,
} from "./fieldConstraints";

describe("expandScientificNotation", () => {
  it.each([
    ["9E+09", "9000000000"],
    ["9e+09", "9000000000"],
    ["9.876543210E+9", "9876543210"],
    ["1.23E+11", "123000000000"],
  ])("expands %s to %s", (input, expected) => {
    expect(expandScientificNotation(input)).toBe(expected);
  });

  it.each(["9876543210", "+919876543210", "Ravi Teja", "", "A+"])(
    "leaves %j untouched",
    (input) => expect(expandScientificNotation(input)).toBe(input)
  );

  it("flags only the exponential form", () => {
    expect(isScientificNotation("9E+09")).toBe(true);
    expect(isScientificNotation("9876543210")).toBe(false);
  });
});

describe("normalizeDigits", () => {
  it("expands Excel's exponential phone and strips separators", () => {
    expect(normalizeDigits("9E+09")).toBe("9000000000");
    expect(normalizeDigits("98765 43210")).toBe("9876543210");
    expect(normalizeDigits("(98765) 43-210")).toBe("9876543210");
  });

  it("keeps a leading + and drops Excel's text-marker apostrophe", () => {
    expect(normalizeDigits("+91 98765 43210")).toBe("+919876543210");
    expect(normalizeDigits("'9876543210")).toBe("9876543210");
  });

  it("returns undefined for blank", () => {
    expect(normalizeDigits("   ")).toBeUndefined();
    expect(normalizeDigits(undefined)).toBeUndefined();
  });
});

describe("matchOption", () => {
  it("matches regardless of case, spacing and punctuation", () => {
    expect(matchOption("ratified", RATIFICATION_STATUS_OPTIONS)).toBe("Ratified");
    expect(matchOption("NOT RATIFIED", RATIFICATION_STATUS_OPTIONS)).toBe("Not Ratified");
    expect(matchOption("not-ratified", RATIFICATION_STATUS_OPTIONS)).toBe("Not Ratified");
  });

  it("rejects a value outside the stated set rather than guessing", () => {
    // The reported case: "yes" in a Ratified / Not Ratified column.
    expect(matchOption("yes", RATIFICATION_STATUS_OPTIONS)).toBeUndefined();
    expect(matchOption("approved", RATIFICATION_STATUS_OPTIONS)).toBeUndefined();
    expect(matchOption("pending", RATIFICATION_STATUS_OPTIONS)).toBeUndefined();
  });

  it("handles the other option sets", () => {
    expect(matchOption("male", GENDER_OPTIONS)).toBe("Male");
    expect(matchOption("o+", BLOOD_GROUP_OPTIONS)).toBe("O+");
    expect(matchOption("Z+", BLOOD_GROUP_OPTIONS)).toBeUndefined();
  });

  it("returns undefined for blank", () => {
    expect(matchOption("", GENDER_OPTIONS)).toBeUndefined();
    expect(matchOption(undefined, GENDER_OPTIONS)).toBeUndefined();
  });
});

describe("parseYesNoStrict", () => {
  it.each([["Yes", true], ["yes", true], ["Y", true], ["No", false], ["n", false]])(
    "reads %j as %j",
    (input, expected) => expect(parseYesNoStrict(input as string)).toBe(expected)
  );

  it.each(["maybe", "1", "ratified", "", undefined])("rejects %j", (input) => {
    expect(parseYesNoStrict(input as string | undefined)).toBeUndefined();
  });
});

describe("parseWholeNumber", () => {
  it("accepts plain digits and expands exponentials", () => {
    expect(parseWholeNumber("10")).toBe(10);
    expect(parseWholeNumber("0")).toBe(0);
    expect(parseWholeNumber("1E+02")).toBe(100);
  });

  it("rejects anything not purely numeric", () => {
    expect(parseWholeNumber("5 years")).toBeUndefined();
    expect(parseWholeNumber("ten")).toBeUndefined();
    expect(parseWholeNumber("2.5")).toBeUndefined();
    expect(parseWholeNumber("-3")).toBeUndefined();
  });

  it("honours a range", () => {
    expect(parseWholeNumber("70", { max: 60 })).toBeUndefined();
    expect(parseWholeNumber("60", { max: 60 })).toBe(60);
  });
});

describe("isValidEmail", () => {
  it.each(["a@b.com", "ravi.teja@college.edu"])("accepts %s", (v) => expect(isValidEmail(v)).toBe(true));
  it.each(["no-at-sign", "has space@x.com", "", undefined])("rejects %j", (v) =>
    expect(isValidEmail(v as string | undefined)).toBe(false)
  );
});
