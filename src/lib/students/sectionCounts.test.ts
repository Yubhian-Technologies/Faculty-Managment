import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { getSectionStudentCounts, invalidateSectionCountCache } from "./sectionCounts";

type Student = { id: string; department: string; section: string; year: number; secondaryDepartment?: string; courseId?: string };

function fakeDb(students: Student[], reads: { n: number }) {
  const students$ = { where: (f: keyof Student, op: string, vals: string[]) => ({ get: async () => { reads.n += 1; return { docs: students.filter((s) => vals.includes(String(s[f] ?? ""))).map((s) => ({ id: s.id, data: () => s })) }; } }) };
  return { collection: () => ({ doc: () => ({ collection: () => students$ }) }) } as unknown as Firestore;
}

describe("getSectionStudentCounts", () => {
  const students: Student[] = [
    { id: "1", department: "CSE", section: "A", year: 2, courseId: "c" },
    { id: "2", department: "CSE", section: "A", year: 2, courseId: "c" },
    { id: "3", department: "BS", section: "B", year: 1, secondaryDepartment: "ECE", courseId: "c" },
  ];

  it("counts per department, section, year, cross-listing and course", async () => {
    invalidateSectionCountCache();
    const m = await getSectionStudentCounts(fakeDb(students, { n: 0 }), "c1", ["CSE", "BS", "ECE"]);
    expect(m.get("CSE|A|2||c")).toBe(2);
    expect(m.get("BS|B|1|ece|c")).toBe(1);
  });

  it("shares one scan between callers until a write invalidates it", async () => {
    invalidateSectionCountCache();
    const reads = { n: 0 };
    const db = fakeDb(students, reads);
    await getSectionStudentCounts(db, "c1", ["CSE"]);
    const first = reads.n;
    await getSectionStudentCounts(db, "c1", ["CSE"]);
    await getSectionStudentCounts(db, "c1", ["CSE"]);
    expect(reads.n).toBe(first);
    invalidateSectionCountCache("c1");
    await getSectionStudentCounts(db, "c1", ["CSE"]);
    expect(reads.n).toBe(first * 2);
  });
});
