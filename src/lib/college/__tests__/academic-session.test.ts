import { describe, it, expect } from "vitest";
import { academicSessionLabel, currentAcademicStartYear } from "@/lib/college/academicSession";

describe("academicSessionLabel", () => {
  it("returns 2025-26 format for a start year of 2025", () => {
    expect(academicSessionLabel(2025)).toBe("2025-26");
  });

  it("returns 2024-25 format for a start year of 2024", () => {
    expect(academicSessionLabel(2024)).toBe("2024-25");
  });

  it("returns 2026-27 format for a start year of 2026", () => {
    expect(academicSessionLabel(2026)).toBe("2026-27");
  });
});

describe("currentAcademicStartYear", () => {
  it("returns a number between 2000 and 2100", () => {
    const year = currentAcademicStartYear();
    expect(typeof year).toBe("number");
    expect(year).toBeGreaterThan(2000);
    expect(year).toBeLessThan(2100);
  });

  it("returns a year whose next year ends with 07 (April 1 boundary)", () => {
    const year = currentAcademicStartYear();
    // The academic year starts April 1, so Jan-Mar belongs to previous session
    const month = new Date().getMonth() + 1; // 1-indexed
    if (month < 4) {
      expect(year).toBe(new Date().getFullYear() - 1);
    } else {
      expect(year).toBe(new Date().getFullYear());
    }
  });
});
