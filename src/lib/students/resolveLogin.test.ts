import { describe, it, expect } from "vitest";
import { fakeFs } from "@/lib/testing/fakeFirestore.testutil";
import { findStudentLoginEmails, placeholderLoginEmail } from "@/lib/students/resolveLogin";

describe("findStudentLoginEmails - global lookup by roll (S3)", () => {
  it("finds the login by the normalised roll, however it is typed", async () => {
    const { firestore } = fakeFs({ "studentUsernames/24PA1A0501": { rollKey: "24pa1a0501", loginEmail: "24pa1a0501@students.internal", active: true } });
    for (const typed of ["24PA1A0501", "24pa1a0501", " 24 PA1A0501 ", "24-PA1A0501", "24/PA1A0501"]) {
      expect(await findStudentLoginEmails(firestore, typed)).toEqual(["24pa1a0501@students.internal"]);
    }
  });

  it("reads exactly the registry documents it needs by id - no query, no scan", async () => {
    const seed: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 300; i++) seed[`studentUsernames/R${i}`] = { loginEmail: `r${i}@students.internal`, active: true };
    const { db, firestore } = fakeFs(seed);
    await findStudentLoginEmails(firestore, "R5");
    expect(db.reads).toBe(0); // document gets, not queries
  });

  it("also finds a legacy account through the old roll-keyed document (punctuated roll)", async () => {
    const { firestore } = fakeFs({ "studentUsernames/24-PA1A0501": { loginEmail: "24-pa1a0501@students.internal" } });
    expect(await findStudentLoginEmails(firestore, "24-pa1a0501")).toEqual(["24-pa1a0501@students.internal"]);
  });

  it("returns both candidates when a roll has a normalised AND a legacy entry, without duplicates", async () => {
    const { firestore } = fakeFs({
      "studentUsernames/24PA1A0501": { loginEmail: "24pa1a0501@students.internal", active: true },
      "studentUsernames/24-PA1A0501": { loginEmail: "24-pa1a0501@students.internal" },
    });
    expect((await findStudentLoginEmails(firestore, "24-PA1A0501")).sort()).toEqual(["24-pa1a0501@students.internal", "24pa1a0501@students.internal"]);
    const same = fakeFs({ "studentUsernames/R1": { loginEmail: "r1@students.internal" } });
    expect(await findStudentLoginEmails(same.firestore, "R1")).toEqual(["r1@students.internal"]);
  });

  it("ignores retired entries and entries with no login on them", async () => {
    const { firestore } = fakeFs({
      "studentUsernames/OLD": { loginEmail: "old@students.internal", active: false },
      "studentUsernames/NOLOGIN": { collegeId: "c1", studentDocId: "s1", active: true }, // roll registered, no login yet
    });
    expect(await findStudentLoginEmails(firestore, "OLD")).toEqual([]);
    expect(await findStudentLoginEmails(firestore, "NOLOGIN")).toEqual([]);
  });

  it("an unknown roll yields nothing - the route answers with a placeholder, never a 'not found'", async () => {
    const { firestore } = fakeFs();
    expect(await findStudentLoginEmails(firestore, "NOPE")).toEqual([]);
    expect(placeholderLoginEmail("NOPE")).toBe("nope@students.internal");
  });

  it("a roll that cannot be a document id, or has no letters or digits, finds nothing and does not throw", async () => {
    const { firestore } = fakeFs();
    await expect(findStudentLoginEmails(firestore, "A/B")).resolves.toEqual([]);
    await expect(findStudentLoginEmails(firestore, "###")).resolves.toEqual([]);
  });
});
