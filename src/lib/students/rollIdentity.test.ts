import { describe, expect, it } from "vitest";
import { fakeFs } from "@/lib/testing/fakeFirestore.testutil";
import {
  STALE_CLAIM_AFTER_MS,
  claimStudentRoll,
  releaseStudentRoll,
  retireStudentRoll,
  rollTakenMessage,
} from "@/lib/students/rollIdentity";

const claim = (roll: string, collegeId: string, studentDocId: string, extra: Record<string, unknown> = {}) => ({ roll, collegeId, studentDocId, name: `${collegeId}/${studentDocId}`, ...extra });

describe("claimStudentRoll - global, normalised uniqueness (S3)", () => {
  it("a free roll is claimed and recorded under its normalised key", async () => {
    const { db, firestore } = fakeFs();
    expect(await claimStudentRoll(firestore, claim("24-pa1a0501", "c1", "s1"))).toEqual({ ok: true, created: true });
    expect(db.get("studentUsernames/24PA1A0501")).toMatchObject({ rollKey: "24pa1a0501", collegeId: "c1", studentDocId: "s1", active: true, rollNumber: "24-pa1a0501" });
  });

  it("the SAME roll in a different COLLEGE is refused, however it is formatted", async () => {
    const { firestore } = fakeFs({ "colleges/c1/students/s1": { name: "Anil" } });
    await claimStudentRoll(firestore, claim("24PA1A0501", "c1", "s1"));
    for (const variant of ["24PA1A0501", "24pa1a0501", " 24 PA1A0501 ", "24-PA1A0501", "24/PA1A0501"]) {
      const res = await claimStudentRoll(firestore, claim(variant, "c2", "x1"));
      expect(res).toMatchObject({ ok: false, code: "TAKEN", holder: { collegeId: "c1", studentDocId: "s1", sameCollege: false } });
    }
  });

  it("the same roll for another student of the SAME college is refused too, and says so", async () => {
    const { firestore } = fakeFs({ "colleges/c1/students/s1": { name: "Anil" } });
    await claimStudentRoll(firestore, claim("R1", "c1", "s1", { name: "Anil" }));
    const res = await claimStudentRoll(firestore, claim("r-1", "c1", "s2"));
    expect(res).toMatchObject({ ok: false, code: "TAKEN", holder: { sameCollege: true, name: "Anil" } });
  });

  it("claiming again for the same student is idempotent and keeps their login", async () => {
    const { db, firestore } = fakeFs({ "colleges/c1/students/s1": { name: "Anil" } });
    await claimStudentRoll(firestore, claim("R1", "c1", "s1"));
    await db.doc("studentUsernames/R1").update({ uid: "u1", loginEmail: "r1@students.internal" });
    expect(await claimStudentRoll(firestore, claim("R1", "c1", "s1"))).toEqual({ ok: true, created: false });
    expect(db.get("studentUsernames/R1")).toMatchObject({ uid: "u1", loginEmail: "r1@students.internal", active: true });
  });

  it("a legacy document that never recorded its student is recognised by the student's login uid", async () => {
    const { firestore } = fakeFs({
      "studentUsernames/R1": { uid: "u1", loginEmail: "r1@students.internal" },
      "colleges/c1/students/s1": { name: "Legacy holder", uid: "u1" },
    });
    expect(await claimStudentRoll(firestore, claim("R1", "c1", "s1", { uid: "u1" }))).toEqual({ ok: true, created: false });
    expect(await claimStudentRoll(firestore, claim("R1", "c2", "s9", { uid: "someone-else" }))).toMatchObject({ ok: false, code: "TAKEN" });
    expect(await claimStudentRoll(firestore, claim("R1", "c2", "s9"))).toMatchObject({ ok: false, code: "TAKEN" });
  });

  it("an empty / symbol-only roll is invalid and writes nothing", async () => {
    const { db, firestore } = fakeFs();
    expect(await claimStudentRoll(firestore, claim("###", "c1", "s1"))).toEqual({ ok: false, code: "INVALID_ROLL" });
    expect(await claimStudentRoll(firestore, claim("  ", "c1", "s1"))).toEqual({ ok: false, code: "INVALID_ROLL" });
    expect(db.docs.size).toBe(0);
  });

  it("CONCURRENT claims of one roll from many colleges: exactly one wins", async () => {
    const { firestore } = fakeFs();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => claimStudentRoll(firestore, claim("24PA1A0501", `c${i}`, `s${i}`))));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(11);
  });

  it("concurrent claims of DIFFERENT rolls all succeed", async () => {
    const { firestore } = fakeFs();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => claimStudentRoll(firestore, claim(`R${i}`, "c1", `s${i}`))));
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("a retired roll can be claimed by anyone, and none of the old holder's login carries over", async () => {
    const { db, firestore } = fakeFs({
      "studentUsernames/R1": { rollKey: "r1", collegeId: "c1", studentDocId: "s1", uid: "u1", loginEmail: "r1@students.internal", active: false },
    });
    expect(await claimStudentRoll(firestore, claim("R1", "c2", "x1"))).toEqual({ ok: true, created: true });
    const doc = db.get("studentUsernames/R1")!;
    expect(doc).toMatchObject({ collegeId: "c2", studentDocId: "x1", active: true });
    expect(doc).not.toHaveProperty("uid");
    expect(doc).not.toHaveProperty("loginEmail");
  });

  it("a stale claim (its student no longer exists and it is old) can be taken over; a fresh one cannot", async () => {
    const old = new Date(Date.now() - STALE_CLAIM_AFTER_MS - 60_000);
    const fresh = new Date();
    const { firestore } = fakeFs({
      "studentUsernames/OLD1": { collegeId: "c1", studentDocId: "gone", active: true, createdAt: old },
      "studentUsernames/NEW1": { collegeId: "c1", studentDocId: "gone", active: true, createdAt: fresh },
      "studentUsernames/LIVE1": { collegeId: "c1", studentDocId: "alive", active: true, createdAt: old },
      "colleges/c1/students/alive": { name: "Alive" },
    });
    expect(await claimStudentRoll(firestore, claim("OLD1", "c2", "x1"))).toMatchObject({ ok: true, created: true });
    expect(await claimStudentRoll(firestore, claim("NEW1", "c2", "x2"))).toMatchObject({ ok: false, code: "TAKEN" });
    expect(await claimStudentRoll(firestore, claim("LIVE1", "c2", "x3"))).toMatchObject({ ok: false, code: "TAKEN" });
  });
});

describe("rollTakenMessage", () => {
  it("names the holder only within the caller's own college - another college's student is never named", () => {
    expect(rollTakenMessage("R1", { sameCollege: true, name: "Anil" })).toContain("Anil");
    const other = rollTakenMessage("R1", { sameCollege: false, name: "Secret Student", collegeId: "c9" });
    expect(other).not.toContain("Secret Student");
    expect(other).not.toContain("c9");
    expect(other).toMatch(/another college/);
  });
});

describe("releaseStudentRoll / retireStudentRoll", () => {
  it("release removes this student's own bare claim, but never someone else's or one with a login", async () => {
    const { db, firestore } = fakeFs({
      "studentUsernames/A": { collegeId: "c1", studentDocId: "s1", active: true },
      "studentUsernames/B": { collegeId: "c1", studentDocId: "s2", active: true },
      "studentUsernames/C": { collegeId: "c1", studentDocId: "s3", active: true, uid: "u3", loginEmail: "c@students.internal" },
    });
    await releaseStudentRoll(firestore, "A", "c1", "s1");
    await releaseStudentRoll(firestore, "B", "c1", "s1"); // not theirs
    await releaseStudentRoll(firestore, "C", "c1", "s3"); // has a login
    await releaseStudentRoll(firestore, "###", "c1", "s1"); // invalid: no-op
    expect(db.get("studentUsernames/A")).toBeUndefined();
    expect(db.get("studentUsernames/B")).toBeDefined();
    expect(db.get("studentUsernames/C")).toBeDefined();
  });

  it("retire switches off the student's registry entries (by roll and by login uid) without deleting them", async () => {
    const { db, firestore } = fakeFs({
      "studentUsernames/R1": { collegeId: "c1", studentDocId: "s1", uid: "u1", active: true },
      "studentUsernames/OLD-R1": { uid: "u1", active: true }, // a legacy entry carrying the same login
      "studentUsernames/OTHER": { collegeId: "c1", studentDocId: "s2", uid: "u2", active: true },
    });
    await retireStudentRoll(firestore, { roll: "r1", collegeId: "c1", studentDocId: "s1", uid: "u1" });
    expect(db.get("studentUsernames/R1")).toMatchObject({ active: false });
    expect(db.get("studentUsernames/OLD-R1")).toMatchObject({ active: false });
    expect(db.get("studentUsernames/OTHER")).toMatchObject({ active: true });
  });

  it("retire never touches another student's entry for the same roll", async () => {
    const { db, firestore } = fakeFs({ "studentUsernames/R1": { collegeId: "c2", studentDocId: "zz", active: true } });
    await retireStudentRoll(firestore, { roll: "R1", collegeId: "c1", studentDocId: "s1" });
    expect(db.get("studentUsernames/R1")).toMatchObject({ active: true });
  });
});
