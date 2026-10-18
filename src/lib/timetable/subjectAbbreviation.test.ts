import { describe, it, expect } from "vitest";
import { subjectAbbreviation } from "./subjectAbbreviation";

describe("subjectAbbreviation", () => {
  it("uses the subject's own short code first", () => expect(subjectAbbreviation("Cryptography & Network Security", " CNSX ")).toBe("CNSX"));
  it("takes the initials, skipping '&' and small words", () => {
    expect(subjectAbbreviation("Cryptography & Network Security")).toBe("CNS");
    expect(subjectAbbreviation("Design and Analysis of Algorithms")).toBe("DAA");
    expect(subjectAbbreviation("Human Resources & Project Management")).toBe("HRPM");
  });
  it("keeps Lab and a trailing numeral", () => {
    expect(subjectAbbreviation("Data Structures Lab")).toBe("DS Lab");
    expect(subjectAbbreviation("Advanced Data Structures & Algorithm Analysis Lab")).toBe("ADSAA Lab");
    expect(subjectAbbreviation("Data Structures II")).toBe("DS II");
  });
  it("leaves a one-word name and an empty name alone", () => {
    expect(subjectAbbreviation("Mathematics")).toBe("Mathematics");
    expect(subjectAbbreviation("Club Activities")).toBe("CA");
    expect(subjectAbbreviation(undefined)).toBe("");
  });
});
