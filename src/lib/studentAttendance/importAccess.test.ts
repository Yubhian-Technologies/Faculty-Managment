import { describe, expect, it } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";
import { mayImportSectionAttendance } from "./importAccess";
import type { Section } from "@/types";

// Bulk student-attendance import: the College Office for any section, an HOD only for the sections they manage.
const C = "colleges/c1";
const db = () => new FakeFirestore({
  [`${C}/users/hodCse`]: { role: "HOD", department: "CSE" },
  [`${C}/users/hodEce`]: { role: "HOD", department: "ECE" },
  [`${C}/departments/cse`]: { name: "CSE" },
  [`${C}/departments/ece`]: { name: "ECE" },
}) as unknown as FirebaseFirestore.Firestore;
const section = (department: string, year: number) => ({ department, year, name: `${department}-A` }) as Section;

describe("who may import a section's attendance", () => {
  it("the College Office: any section", async () => {
    expect(await mayImportSectionAttendance(db(), { collegeId: "c1", uid: "office", role: "COLLEGE_OFFICE" }, section("ECE", 2))).toBe(true);
  });

  it("an HOD: their own department's sections only", async () => {
    const d = db();
    expect(await mayImportSectionAttendance(d, { collegeId: "c1", uid: "hodCse", role: "HOD" }, section("CSE", 2))).toBe(true);
    expect(await mayImportSectionAttendance(d, { collegeId: "c1", uid: "hodCse", role: "HOD" }, section("ECE", 2))).toBe(false);
  });
});
