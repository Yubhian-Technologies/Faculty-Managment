import { describe, expect, it } from "vitest";
import { maskAadhaar, maskSensitiveIds, maskTail } from "./mask";

describe("masking", () => {
  it("keeps only the last four characters", () => {
    expect(maskTail("ABCDE1234F")).toBe("XXXXXX234F");
    expect(maskTail("1234")).toBe("XXXX");
    expect(maskTail("")).toBe("");
    expect(maskTail(undefined)).toBe("");
  });
  it("formats Aadhaar like the card", () => {
    expect(maskAadhaar("1234 5678 9012")).toBe("XXXX XXXX 9012");
  });
  it("masks every sensitive field and leaves the rest", () => {
    const out = maskSensitiveIds({ name: "A", aadharNo: "123456789012", panNo: "ABCDE1234F", bankAccountNumber: "000111222333", ifscCode: "SBIN0001" });
    expect(out).toEqual({ name: "A", aadharNo: "XXXX XXXX 9012", panNo: "XXXXXX234F", bankAccountNumber: "XXXXXXXX2333", ifscCode: "SBIN0001" });
  });
});
