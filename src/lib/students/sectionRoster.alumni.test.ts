import { describe, expect, it } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";
import { countSectionStudents, fetchSectionStudents } from "./sectionRoster";

// Graduated students keep their section and year; they are not part of the class any more, and
// the roster and the headcount must agree on that.

const S = "colleges/c1/students";
const stu = (over: Record<string, unknown>) => ({ department: "CSE", section: "A", year: 4, courseId: "btech", status: "REGULAR", name: "n", rollNumber: "r", ...over });
const identity = { department: "CSE", sectionName: "A", year: 4, courseId: "btech" };

function setup() {
  const db = new FakeFirestore({
    [`${S}/s1`]: stu({ name: "Current 1" }),
    [`${S}/s2`]: stu({ name: "Detained", status: "DETAINED" }),
    [`${S}/s3`]: stu({ name: "Alumnus", status: "GRADUATED" }),
    [`${S}/s4`]: stu({ name: "Branch student", department: "BS", secondaryDepartment: "CSE" }),
    [`${S}/s5`]: stu({ name: "Branch alumnus", department: "BS", secondaryDepartment: "CSE", status: "GRADUATED" }),
    [`${S}/s6`]: stu({ name: "No status field", status: undefined }),
    [`${S}/s7`]: stu({ name: "Other section", section: "B" }),
  });
  return db.collection("colleges").doc("c1") as unknown as FirebaseFirestore.DocumentReference;
}

describe("section roster and headcount", () => {
  it("leaves graduated students out of the roster, keeps everyone else", async () => {
    const names = (await fetchSectionStudents(setup(), identity)).map((s) => s.name).sort();
    expect(names).toEqual(["Branch student", "Current 1", "Detained", "No status field"]);
  });

  it("counts exactly the students the roster returns", async () => {
    const ref = setup();
    expect(await countSectionStudents(ref, identity)).toBe((await fetchSectionStudents(ref, identity)).length);
  });
});
