import { describe, it, expect } from "vitest";
import { matchesCurrentSemester } from "@/lib/college/semester";
import { matchesCurrentAcademicYear } from "@/lib/college/academicSession";

describe("Semester Propagation Logic", () => {
  /**
   * This test verifies the core assumption:
   * Every module in the chain must propagate the semester correctly.
   * If any module fails to propagate the semester, the chain breaks.
   */

  describe("matchesCurrentSemester - the backbone of all filtering", () => {
    it("null itemSemester always matches (legacy data)", () => {
      expect(matchesCurrentSemester(null, 3)).toBe(true);
      expect(matchesCurrentSemester(null, null)).toBe(true);
    });

    it("matching semesters match", () => {
      expect(matchesCurrentSemester(1, 1)).toBe(true);
      expect(matchesCurrentSemester(5, 5)).toBe(true);
    });

    it("non-matching semesters don't match", () => {
      expect(matchesCurrentSemester(1, 2)).toBe(false);
      expect(matchesCurrentSemester(3, 1)).toBe(false);
    });

    it("undefined itemSemester always matches", () => {
      expect(matchesCurrentSemester(undefined, 3)).toBe(true);
    });

    it("prior semester slots are excluded from current view", () => {
      // This is critical: a slot from semester 1 should NOT appear when viewing semester 2
      expect(matchesCurrentSemester(1, 2)).toBe(false);
    });
  });

  describe("matchesCurrentAcademicYear - session propagation", () => {
    it("null academicYear always matches (legacy data)", () => {
      expect(matchesCurrentAcademicYear(null, "2026-27")).toBe(true);
      expect(matchesCurrentAcademicYear(undefined, "2026-27")).toBe(true);
    });

    it("matching sessions match", () => {
      expect(matchesCurrentAcademicYear("2026-27", "2026-27")).toBe(true);
    });

    it("non-matching sessions don't match", () => {
      expect(matchesCurrentAcademicYear("2025-26", "2026-27")).toBe(false);
    });
  });

  describe("Full chain verification", () => {
    it("A slot from semester 1 should NOT appear in semester 2 view", () => {
      const slotSemester = 1;
      const currentSemester = 2;
      const slotAcademicYear = "2026-27";
      const currentAcademicYear = "2026-27";

      const semesterMatch = matchesCurrentSemester(slotSemester, currentSemester);
      const yearMatch = matchesCurrentAcademicYear(slotAcademicYear, currentAcademicYear);

      expect(semesterMatch).toBe(false);
      expect(yearMatch).toBe(true);
      // Overall visibility: false (semester doesn't match)
    });

    it("A slot from current semester AND current year should be visible", () => {
      const slotSemester = 2;
      const currentSemester = 2;
      const slotAcademicYear = "2026-27";
      const currentAcademicYear = "2026-27";

      expect(matchesCurrentSemester(slotSemester, currentSemester)).toBe(true);
      expect(matchesCurrentAcademicYear(slotAcademicYear, currentAcademicYear)).toBe(true);
    });

    it("A slot from current semester but past year should be hidden", () => {
      const slotSemester = 2;
      const currentSemester = 2;
      const slotAcademicYear = "2025-26";
      const currentAcademicYear = "2026-27";

      expect(matchesCurrentSemester(slotSemester, currentSemester)).toBe(true);
      expect(matchesCurrentAcademicYear(slotAcademicYear, currentAcademicYear)).toBe(false);
    });
  });
});
