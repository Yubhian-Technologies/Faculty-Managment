import { describe, expect, it } from "vitest";
import { fakeFs } from "@/lib/testing/fakeFirestore.testutil";
import { loadExistingStudentsForImport } from "@/lib/students/importExisting";

const resolveDepartment = (raw: string) => ({ cse: "CSE", ece: "ECE" } as Record<string, string>)[raw.trim().toLowerCase()];

function roster(count: number) {
  const seed: Record<string, Record<string, unknown>> = {};
  for (let i = 0; i < count; i++) {
    seed[`colleges/c1/students/s${i}`] = {
      rollNumber: `24R${i}`, rollNumberUpper: `24R${i}`, department: "CSE", year: 1, section: "A",
      admissionNo: `ADM${i}`, hallTicketNo: `HT${i}`, email: `s${i}@x.com`,
    };
  }
  return seed;
}

const ids = (docs: { id: string }[]) => docs.map((d) => d.id).sort();

describe("loadExistingStudentsForImport (S7: no full-roster read)", () => {
  it("returns exactly the students a file's rows could collide with, and reads only those", async () => {
    const { db, firestore } = fakeFs(roster(2000));
    const before = db.reads;
    const found = await loadExistingStudentsForImport(firestore, "c1", [{ rollNumber: "24R5" }, { rollNumber: "24r7" }], resolveDepartment);
    expect(ids(found)).toEqual(["s5", "s7"]);
    // 2,000 students on file; a 2-row import must not read anywhere near that many.
    expect(db.reads - before).toBeLessThan(20);
  });

  it("matches a roll typed in any case (stamped rollNumberUpper)", async () => {
    const { firestore } = fakeFs(roster(10));
    expect(ids(await loadExistingStudentsForImport(firestore, "c1", [{ rollNumber: "24r3" }], resolveDepartment))).toEqual(["s3"]);
  });

  it("still finds legacy students that have no rollNumberUpper, by their stored spelling", async () => {
    const { firestore } = fakeFs({
      "colleges/c1/students/legacy": { rollNumber: "24LEG1", department: "CSE", year: 1, section: "A" },
      "colleges/c1/students/legacy2": { rollNumber: "24leg2", department: "CSE", year: 1, section: "A" },
    });
    const found = await loadExistingStudentsForImport(firestore, "c1", [{ rollNumber: "24leg1" }, { rollNumber: "24LEG2" }], resolveDepartment);
    expect(ids(found)).toEqual(["legacy", "legacy2"]);
  });

  it("finds holders of a row's admission number, hall ticket and email (the other duplicate checks)", async () => {
    const { firestore } = fakeFs(roster(50));
    const found = await loadExistingStudentsForImport(
      firestore, "c1",
      [{ rollNumber: "NEW1", admissionNo: "adm4" }, { rollNumber: "NEW2", hallTicketNo: "HT9" }, { rollNumber: "NEW3", email: "S12@X.COM" }],
      resolveDepartment
    );
    expect(ids(found)).toEqual(["s12", "s4", "s9"]);
  });

  it("brings in the UNASSIGNED students of the file's departments and years for the name check, and no assigned ones", async () => {
    const { firestore } = fakeFs({
      "colleges/c1/students/un1": { rollNumber: "U1", department: "CSE", year: 1, section: "" },
      "colleges/c1/students/un2": { rollNumber: "U2", department: "ECE", secondaryDepartment: "CSE", year: 1, section: "" },
      "colleges/c1/students/assigned": { rollNumber: "A1", department: "CSE", year: 1, section: "A" },
      "colleges/c1/students/otherYear": { rollNumber: "Y2", department: "CSE", year: 2, section: "" },
      "colleges/c1/students/otherDept": { rollNumber: "D1", department: "MECH", year: 1, section: "" },
    });
    const found = await loadExistingStudentsForImport(firestore, "c1", [{ rollNumber: "NEW", department: "cse", year: 1 }], resolveDepartment);
    expect(ids(found)).toEqual(["un1", "un2"]);
  });

  it("a student matched by several queries appears once", async () => {
    const { firestore } = fakeFs({ "colleges/c1/students/s1": { rollNumber: "R1", rollNumberUpper: "R1", admissionNo: "A1", department: "CSE", year: 1, section: "" } });
    const found = await loadExistingStudentsForImport(firestore, "c1", [{ rollNumber: "R1", admissionNo: "A1", department: "CSE", year: 1 }], resolveDepartment);
    expect(found).toHaveLength(1);
  });

  it("handles a 500-row file (more than one `in` chunk) and an empty file", async () => {
    const { db, firestore } = fakeFs(roster(600));
    const rows = Array.from({ length: 500 }, (_, i) => ({ rollNumber: `24R${i}` }));
    expect(await loadExistingStudentsForImport(firestore, "c1", rows, resolveDepartment)).toHaveLength(500);
    const before = db.reads;
    expect(await loadExistingStudentsForImport(firestore, "c1", [], resolveDepartment)).toEqual([]);
    expect(db.reads - before).toBe(0);
  });

  it("does not look in another college", async () => {
    const { firestore } = fakeFs({ "colleges/other/students/x": { rollNumber: "R1", rollNumberUpper: "R1" } });
    expect(await loadExistingStudentsForImport(firestore, "c1", [{ rollNumber: "R1" }], resolveDepartment)).toEqual([]);
  });
});
