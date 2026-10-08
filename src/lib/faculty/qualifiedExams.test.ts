import { describe, expect, it } from "vitest";
import { qualifiedExamList, qualifiedExamName } from "./qualifiedExams";
import { applyAcademicProfileChanges, diffAcademicProfile, academicProfileFirestoreUpdates } from "./academicProfileChanges";

describe("multiple NET/SLET/SET/GATE/Others exams", () => {
  const legacy = { netSletSetGateOthers: "YES" as const, qualifiedExam: "GATE" as const, examScore: "620", qualifiedYear: 2015 };

  it("a record saved before this existed still reads as exactly one exam", () => {
    expect(qualifiedExamList(legacy)).toEqual([{ name: "GATE", score: "620", year: "2015" }]);
  });

  it("further exams are listed after the first, each with its own score and year", () => {
    const list = qualifiedExamList({
      ...legacy,
      additionalQualifiedExams: [
        { exam: "NET", examScore: "70", qualifiedYear: 2018 },
        { exam: "OTHER", pleaseSpecifyExam: "CSIR", qualifiedYear: 2020 },
      ],
    });
    expect(list).toEqual([
      { name: "GATE", score: "620", year: "2015" },
      { name: "NET", score: "70", year: "2018" },
      { name: "CSIR", score: "", year: "2020" },
    ]);
  });

  it("nothing is listed unless the answer is Yes, but the extra exams are never removed from the record", () => {
    const rec = { ...legacy, netSletSetGateOthers: "NO" as const, additionalQualifiedExams: [{ exam: "SET" as const }] };
    expect(qualifiedExamList(rec)).toEqual([]);
    expect(rec.additionalQualifiedExams).toHaveLength(1);
  });

  it("an empty extra row is ignored in displays, a named one is shown", () => {
    expect(qualifiedExamList({ ...legacy, additionalQualifiedExams: [{}] })).toHaveLength(1);
  });

  it("names: Others uses the typed text, a blank Others falls back to the label", () => {
    expect(qualifiedExamName("OTHER", "CSIR-UGC")).toBe("CSIR-UGC");
    expect(qualifiedExamName("OTHER", "")).toBe("Others");
    expect(qualifiedExamName("NET")).toBe("NET");
  });
});

describe("saving exams 2+ only touches that key (nothing else in the profile can be lost)", () => {
  const stored = {
    highestQualification: "Ph.D",
    netSletSetGateOthers: "YES",
    qualifiedExam: "GATE",
    examScore: "620",
    qualifiedYear: 2015,
    ugDetails: { course: "B.Tech" },
  };

  it("adding a second exam sends one key", () => {
    const next = { ...stored, additionalQualifiedExams: [{ exam: "NET", qualifiedYear: 2018 }] };
    const changes = diffAcademicProfile(stored, next);
    expect(Object.keys(changes.set)).toEqual(["additionalQualifiedExams"]);
    expect(changes.remove).toEqual([]);
    const merged = applyAcademicProfileChanges(stored, changes) as Record<string, unknown>;
    expect(merged.ugDetails).toEqual({ course: "B.Tech" });
    expect(merged.qualifiedExam).toBe("GATE");
    expect(merged.additionalQualifiedExams).toEqual([{ exam: "NET", qualifiedYear: 2018 }]);
  });

  it("removing every extra exam removes just that key; the first exam is kept", () => {
    const withExtra = { ...stored, additionalQualifiedExams: [{ exam: "NET" }] };
    const changes = diffAcademicProfile(withExtra, stored);
    expect(changes.remove).toEqual(["additionalQualifiedExams"]);
    expect(changes.set).toEqual({});
  });

  it("is written as a Firestore dot-path for that key only", () => {
    const changes = diffAcademicProfile(stored, { ...stored, additionalQualifiedExams: [{ exam: "SET" }] });
    const updates = academicProfileFirestoreUpdates(stored, changes, "DELETE") as Record<string, unknown>;
    expect(Object.keys(updates).filter((k) => k.startsWith("academicProfile"))).toEqual(["academicProfile.additionalQualifiedExams"]);
  });
});
