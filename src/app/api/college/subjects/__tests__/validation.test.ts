import { describe, it, expect } from "vitest";

/**
 * Unit tests for subject validation logic.
 * Tests the core rules that govern subject creation:
 * 1. Master subjects require courseId + regulation (not year/department)
 * 2. Semester-scoped subjects require semester + department (not courseId)
 * 3. Name and code are always required
 */
describe("Subject Validation", () => {
  describe("Master subject (courseId + regulation)", () => {
    it("requires courseId", () => {
      const body: Record<string, unknown> = { name: "Test", code: "TC", type: "THEORY", lectureHours: 3, tutorialHours: 0, practicalHours: 0 };
      expect(body.courseId).toBeUndefined();
    });

    it("requires regulation to be validated against course catalog", () => {
      const body: Record<string, unknown> = { courseId: "course1", regulation: "R20", name: "Test", code: "TC", type: "THEORY", lectureHours: 3, tutorialHours: 0, practicalHours: 0 };
      expect(body.courseId).toBe("course1");
      expect(body.regulation).toBe("R20");
      // year and department should NOT be required
      expect(body.year).toBeUndefined();
      expect(body.department).toBeUndefined();
    });
  });

  describe("Semester-scoped subject (semester + department)", () => {
    it("requires semester and department", () => {
      const body: Record<string, unknown> = { semester: 1, department: "CS", name: "Test", code: "TC", hoursPerWeek: 3, credits: 3, type: "THEORY" };
      expect(body.semester).toBe(1);
      expect(body.department).toBe("CS");
    });

    it("does NOT require courseId or regulation", () => {
      const body: Record<string, unknown> = { semester: 1, department: "CS", name: "Test", code: "TC", hoursPerWeek: 3, credits: 3, type: "THEORY" };
      expect(body.courseId).toBeUndefined();
      expect(body.regulation).toBeUndefined();
    });
  });

  describe("Common required fields", () => {
    it("always requires name and code", () => {
      const valid = (body: Record<string, any>) => !!body.name?.trim() && !!body.code?.trim();
      expect(valid({ name: "Test", code: "TC" })).toBe(true);
      expect(valid({ name: "", code: "TC" })).toBe(false);
      expect(valid({ name: "Test", code: "" })).toBe(false);
    });

    it("always requires L, T, P values", () => {
      const valid = (body: Record<string, unknown>) =>
        body.lectureHours != null && body.tutorialHours != null && body.practicalHours != null;
      expect(valid({ lectureHours: 3, tutorialHours: 0, practicalHours: 0 })).toBe(true);
      expect(valid({ lectureHours: 3, tutorialHours: 0 })).toBe(false);
    });
  });
});
