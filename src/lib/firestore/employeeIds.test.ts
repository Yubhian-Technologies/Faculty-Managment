import { describe, it, expect } from "vitest";
import { fakeFs } from "@/lib/testing/fakeFirestore.testutil";
import { employeeIdTaken, employeeIdTakenMessage, loadTakenEmployeeIds, nextEmployeeId } from "@/lib/firestore/employeeIds";

describe("employeeIdTaken (F6: one rule for faculty and staff)", () => {
  it("a faculty member in ANY college holds the id", async () => {
    const { firestore } = fakeFs({ "colleges/other/facultyMembers/f1": { employeeId: "EMP0001" } });
    expect(await employeeIdTaken(firestore, "c1", "EMP0001")).toEqual({ taken: true, heldBy: "faculty" });
  });

  it("a staff member of the SAME college holds it, a staff member of another college does not", async () => {
    const { firestore } = fakeFs({
      "colleges/c1/supportingStaff/s1": { employeeId: "S-1" },
      "colleges/c2/supportingStaff/s2": { employeeId: "S-2" },
    });
    expect(await employeeIdTaken(firestore, "c1", "S-1")).toEqual({ taken: true, heldBy: "staff" });
    expect(await employeeIdTaken(firestore, "c1", "S-2")).toEqual({ taken: false });
  });

  it("editing a record does not clash with itself, but still clashes with others", async () => {
    const { firestore } = fakeFs({
      "colleges/c1/facultyMembers/f1": { employeeId: "EMP0001" },
      "colleges/c1/supportingStaff/s1": { employeeId: "EMP0001" },
    });
    expect((await employeeIdTaken(firestore, "c1", "EMP0001", { collection: "facultyMembers", id: "f1" })).heldBy).toBe("staff");
    expect((await employeeIdTaken(firestore, "c1", "EMP0001", { collection: "supportingStaff", id: "s1" })).heldBy).toBe("faculty");
  });

  it("blank ids are never 'taken'; the message names the holder", async () => {
    const { firestore } = fakeFs();
    expect(await employeeIdTaken(firestore, "c1", "   ")).toEqual({ taken: false });
    expect(employeeIdTakenMessage({ taken: true, heldBy: "staff" })).toMatch(/supporting staff/);
    expect(employeeIdTakenMessage({ taken: true, heldBy: "faculty" })).toBe("Employee ID already exists");
  });
});

describe("nextEmployeeId (counter in a transaction)", () => {
  it("seeds from the highest EMP number already in use across faculty and staff", async () => {
    const { firestore } = fakeFs({
      "colleges/c1/facultyMembers/f1": { employeeId: "EMP0007" },
      "colleges/c1/facultyMembers/f2": { employeeId: "EMP0003" },
      "colleges/c1/supportingStaff/s1": { employeeId: "EMP0009" },
      "colleges/c1/supportingStaff/s2": { employeeId: "CUSTOM-42" }, // not an EMP number: ignored for seeding
    });
    expect(await nextEmployeeId(firestore, "c1")).toBe("EMP0010");
    expect(await nextEmployeeId(firestore, "c1")).toBe("EMP0011");
  });

  it("starts at EMP0001 for an empty college", async () => {
    const { firestore } = fakeFs();
    expect(await nextEmployeeId(firestore, "c1")).toBe("EMP0001");
  });

  it("never repeats an id after a deletion (the old count+1 scheme did)", async () => {
    const { db, firestore } = fakeFs({
      "colleges/c1/facultyMembers/f1": { employeeId: "EMP0001" },
      "colleges/c1/facultyMembers/f2": { employeeId: "EMP0002" },
      "colleges/c1/facultyMembers/f3": { employeeId: "EMP0003" },
    });
    expect(await nextEmployeeId(firestore, "c1")).toBe("EMP0004");
    db.docs.delete("colleges/c1/facultyMembers/f1"); // count is now 2 -> count+1 would give EMP0003 (taken)
    db.docs.set("colleges/c1/facultyMembers/f4", { employeeId: "EMP0004" });
    expect(await nextEmployeeId(firestore, "c1")).toBe("EMP0005");
  });

  it("skips a number somebody already typed in by hand", async () => {
    const { db, firestore } = fakeFs();
    expect(await nextEmployeeId(firestore, "c1")).toBe("EMP0001");
    db.docs.set("colleges/other/facultyMembers/x", { employeeId: "EMP0002" }); // held by faculty in another college
    db.docs.set("colleges/c1/supportingStaff/y", { employeeId: "EMP0003" });
    expect(await nextEmployeeId(firestore, "c1")).toBe("EMP0004");
  });

  it("concurrent callers all get DIFFERENT ids", async () => {
    const { firestore } = fakeFs({ "colleges/c1/facultyMembers/f1": { employeeId: "EMP0005" } });
    const ids = await Promise.all(Array.from({ length: 12 }, () => nextEmployeeId(firestore, "c1")));
    expect(new Set(ids).size).toBe(12);
    expect(ids.every((id) => /^EMP\d{4}$/.test(id))).toBe(true);
    expect(ids.sort()[0]).toBe("EMP0006");
  });

  it("counters are per college", async () => {
    const { firestore } = fakeFs({ "colleges/c2/facultyMembers/f1": { employeeId: "EMP0001" } });
    expect(await nextEmployeeId(firestore, "c1")).toBe("EMP0002"); // EMP0001 is held by a faculty member elsewhere -> skipped
    expect(await nextEmployeeId(firestore, "c2")).toBe("EMP0002");
  });
});

describe("loadTakenEmployeeIds (importer lookup)", () => {
  it("returns only the file's ids that are held, case-insensitively, from faculty and same-college staff", async () => {
    const { firestore } = fakeFs({
      "colleges/c1/facultyMembers/f1": { employeeId: "EMP0001" },
      "colleges/c2/facultyMembers/f2": { employeeId: "emp0002" },
      "colleges/c1/supportingStaff/s1": { employeeId: "S-9" },
      "colleges/c2/supportingStaff/s2": { employeeId: "S-8" },
      "colleges/c1/facultyMembers/f9": { employeeId: "UNRELATED" },
    });
    const taken = await loadTakenEmployeeIds(firestore, "c1", ["EMP0001", "EMP0002", "s-9", "S-8", "FREE"]);
    expect([...taken].sort()).toEqual(["emp0001", "emp0002", "s-9"]);
  });

  it("reads only the matching documents, not every faculty member of every college", async () => {
    const seed: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 200; i++) seed[`colleges/c${i % 5}/facultyMembers/f${i}`] = { employeeId: `EMP${String(i).padStart(4, "0")}` };
    const { db, firestore } = fakeFs(seed);
    await loadTakenEmployeeIds(firestore, "c1", ["EMP0001", "EMP0150"]);
    expect(db.reads).toBeLessThanOrEqual(2);
  });

  it("handles more than 30 ids (query chunking) and empty input", async () => {
    const seed: Record<string, Record<string, unknown>> = {};
    const ids: string[] = [];
    for (let i = 0; i < 70; i++) {
      ids.push(`E${i}`);
      if (i % 2 === 0) seed[`colleges/c1/facultyMembers/f${i}`] = { employeeId: `E${i}` };
    }
    const { firestore } = fakeFs(seed);
    expect((await loadTakenEmployeeIds(firestore, "c1", ids)).size).toBe(35);
    expect((await loadTakenEmployeeIds(firestore, "c1", [])).size).toBe(0);
  });
});
