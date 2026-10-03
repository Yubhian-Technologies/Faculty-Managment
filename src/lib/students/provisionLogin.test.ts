import { describe, it, expect } from "vitest";
import { fakeAuth, fakeFs } from "@/lib/testing/fakeFirestore.testutil";
import {
  StudentLoginError,
  clearMustChangePassword,
  provisionStudentLogin,
  resetStudentLoginPassword,
  setStudentLoginActive,
  syncStudentRollChange,
} from "@/lib/students/provisionLogin";
import type { StudentRecord } from "@/types";

const PW = "Chosen-by-office-1";

const student = (over: Record<string, unknown> = {}) =>
  ({ name: "Anil Kumar", rollNumber: "24PA1A0501", status: "REGULAR", department: "CSE", year: 2, section: "A", ...over }) as unknown as StudentRecord;

function setup(seed: Record<string, Record<string, unknown>> = {}) {
  const fs = fakeFs({ "colleges/c1/students/s1": { name: "Anil Kumar", rollNumber: "24PA1A0501", status: "REGULAR" }, ...seed });
  const au = fakeAuth();
  return { ...fs, ...au };
}

describe("provisionStudentLogin - global identity, password chosen by the office (S1/S3)", () => {
  it("creates the login with EXACTLY the supplied password, on the roll-only identity, and stores no password anywhere", async () => {
    const { db, firestore, auth, adminAuth } = setup();
    const res = await provisionStudentLogin(firestore, adminAuth, "c1", "s1", student(), "office1", PW);

    expect(res).toEqual({ uid: expect.any(String), loginEmail: "24pa1a0501@students.internal", alreadyExisted: false });
    expect(res).not.toHaveProperty("password");

    const authUser = [...auth.users.values()][0];
    expect(authUser).toMatchObject({ email: "24pa1a0501@students.internal", password: PW, customClaims: { role: "STUDENT", collegeId: "c1" } });

    expect(db.get("colleges/c1/students/s1")).toMatchObject({ uid: res.uid, loginEmail: res.loginEmail, rollNumberUpper: "24PA1A0501" });
    expect(db.get(`colleges/c1/users/${res.uid}`)).toMatchObject({ role: "STUDENT", isActive: true });
    expect(db.get(`systemUsers/${res.uid}`)).toMatchObject({ role: "STUDENT", collegeId: "c1" });
    expect(db.get("studentUsernames/24PA1A0501")).toMatchObject({ uid: res.uid, loginEmail: res.loginEmail, collegeId: "c1", studentDocId: "s1", active: true });

    // The password is in Firebase Auth only: no Firestore document contains it.
    expect(JSON.stringify([...db.docs.entries()])).not.toContain(PW);
  });

  it("does not force a password change (the office chose it; students may change it whenever they like)", async () => {
    const { db, firestore, adminAuth } = setup();
    const res = await provisionStudentLogin(firestore, adminAuth, "c1", "s1", student(), "o", PW);
    expect(db.get("colleges/c1/students/s1")).not.toHaveProperty("mustChangePassword");
    expect(db.get(`colleges/c1/users/${res.uid}`)).not.toHaveProperty("mustChangePassword");
  });

  it("never invents a password: a missing, short or padded one is refused before any Auth call", async () => {
    const { firestore, adminAuth, auth } = setup();
    for (const bad of [undefined, null, "", "short", " Abcdef12", "Abcdef12 "]) {
      await expect(provisionStudentLogin(firestore, adminAuth, "c1", "s1", student(), "o", bad as unknown as string)).rejects.toMatchObject({ status: 400 });
    }
    expect(auth.calls).toHaveLength(0);
  });

  it("is a no-op for a student who already has a login", async () => {
    const { firestore, adminAuth, auth } = setup();
    const again = await provisionStudentLogin(firestore, adminAuth, "c1", "s1", student({ uid: "u9", loginEmail: "x@students.internal" }), "o", PW);
    expect(again).toEqual({ uid: "u9", loginEmail: "x@students.internal", alreadyExisted: true });
    expect(auth.users.size).toBe(0);
  });

  it("the same roll in ANOTHER college is refused: roll numbers are globally unique, so there is one account per roll", async () => {
    const fs = fakeFs({
      "colleges/c1/students/s1": { name: "A", rollNumber: "R1", status: "REGULAR" },
      "colleges/c2/students/s2": { name: "B", rollNumber: "r-1", status: "REGULAR" },
    });
    const { auth, adminAuth } = fakeAuth();
    const a = await provisionStudentLogin(fs.firestore, adminAuth, "c1", "s1", student({ name: "A", rollNumber: "R1" }), "o", PW);
    await expect(
      provisionStudentLogin(fs.firestore, adminAuth, "c2", "s2", student({ name: "B", rollNumber: "r-1" }), "o", PW)
    ).rejects.toMatchObject({ status: 409 });
    expect(auth.users.size).toBe(1);
    expect(auth.users.get(a.uid)?.customClaims).toEqual({ role: "STUDENT", collegeId: "c1" });
    expect(fs.db.get("studentUsernames/R1")).toMatchObject({ collegeId: "c1", uid: a.uid });
  });

  it("the refusal never names a student of another college", async () => {
    const fs = fakeFs({
      "colleges/c1/students/s1": { name: "Secret Name", rollNumber: "R1", status: "REGULAR" },
      "colleges/c2/students/s2": { name: "B", rollNumber: "R1", status: "REGULAR" },
    });
    const { adminAuth } = fakeAuth();
    await provisionStudentLogin(fs.firestore, adminAuth, "c1", "s1", student({ name: "Secret Name", rollNumber: "R1" }), "o", PW);
    const err = await provisionStudentLogin(fs.firestore, adminAuth, "c2", "s2", student({ name: "B", rollNumber: "R1" }), "o", PW).catch((e) => e);
    expect(err).toBeInstanceOf(StudentLoginError);
    expect((err as Error).message).not.toContain("Secret Name");
  });

  it("refuses a second student of the same college whose roll reduces to the same identity", async () => {
    const { firestore, adminAuth } = setup({ "colleges/c1/students/s2": { name: "Other", rollNumber: "24-PA1A0501", status: "REGULAR" } });
    await provisionStudentLogin(firestore, adminAuth, "c1", "s1", student(), "o", PW);
    await expect(
      provisionStudentLogin(firestore, adminAuth, "c1", "s2", student({ name: "Other", rollNumber: "24-PA1A0501" }), "o", PW)
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a roll that already has a login in this college (data from before uniqueness was enforced), case-insensitively", async () => {
    const { firestore, adminAuth } = setup({
      "colleges/c1/students/s0": { name: "Holder", rollNumber: "24pa1a0501", rollNumberUpper: "24PA1A0501", uid: "uX", status: "REGULAR" },
    });
    await expect(provisionStudentLogin(firestore, adminAuth, "c1", "s1", student(), "o", PW)).rejects.toBeInstanceOf(StudentLoginError);
  });

  it("validates before touching Auth: no roll, not REGULAR, nothing usable in the roll", async () => {
    const { firestore, adminAuth, auth } = setup();
    await expect(provisionStudentLogin(firestore, adminAuth, "c1", "s1", student({ rollNumber: " " }), "o", PW)).rejects.toMatchObject({ status: 400 });
    await expect(provisionStudentLogin(firestore, adminAuth, "c1", "s1", student({ status: "GRADUATED" }), "o", PW)).rejects.toMatchObject({ status: 400 });
    await expect(provisionStudentLogin(firestore, adminAuth, "c1", "s1", student({ rollNumber: "###" }), "o", PW)).rejects.toMatchObject({ status: 400 });
    expect(auth.calls.filter((c) => c.fn === "createUser")).toHaveLength(0);
  });

  it("ROLLBACK: if the Firestore writes fail, the Auth user it created is deleted again and the retry works", async () => {
    const { db, firestore, adminAuth, auth } = setup();
    const realBatch = db.batch.bind(db);
    db.batch = () => {
      const b = realBatch();
      b.commit = async () => { throw new Error("firestore unavailable"); };
      return b;
    };
    await expect(provisionStudentLogin(firestore, adminAuth, "c1", "s1", student(), "o", PW)).rejects.toThrow("firestore unavailable");
    expect(auth.users.size).toBe(0);
    expect(db.get("colleges/c1/students/s1")?.uid).toBeUndefined();

    db.batch = realBatch;
    const ok = await provisionStudentLogin(firestore, adminAuth, "c1", "s1", student(), "o", PW);
    expect(ok.alreadyExisted).toBe(false);
    expect(auth.users.size).toBe(1);
  });

  it("idempotent by email: reuses a genuine orphan Auth user and gives it the supplied password", async () => {
    const { db, firestore, adminAuth, auth } = setup();
    const orphan = await auth.createUser({ email: "24pa1a0501@students.internal", password: "old-password" });
    const res = await provisionStudentLogin(firestore, adminAuth, "c1", "s1", student(), "o", PW);
    expect(res.uid).toBe(orphan.uid);
    expect(auth.users.size).toBe(1);
    expect(auth.users.get(orphan.uid)?.password).toBe(PW);
    expect(db.get("colleges/c1/students/s1")?.uid).toBe(orphan.uid);
  });

  it("never hijacks an Auth user that belongs to someone else (a profile anywhere, or a registry entry of another roll)", async () => {
    const seeds: Record<string, Record<string, unknown>>[] = [
      { "systemUsers/uOther": { role: "PANEL_MEMBER" } },
      { "studentUsernames/SOMETHING-ELSE": { uid: "uOther", loginEmail: "x@students.internal" } },
      { "colleges/c1/users/uOther": { role: "STUDENT" } },
    ];
    for (const seed of seeds) {
      const { firestore, adminAuth, auth } = setup(seed);
      auth.users.set("uOther", { uid: "uOther", email: "24pa1a0501@students.internal", password: "theirs", disabled: false, customClaims: {} });
      await expect(provisionStudentLogin(firestore, adminAuth, "c1", "s1", student(), "o", PW)).rejects.toMatchObject({ status: 409 });
      expect(auth.users.get("uOther")?.password).toBe("theirs");
    }
  });

  it("a student from before the registry existed gets their registry entry when the login is created", async () => {
    const { db, firestore, adminAuth } = setup();
    expect(db.get("studentUsernames/24PA1A0501")).toBeUndefined();
    await provisionStudentLogin(firestore, adminAuth, "c1", "s1", student(), "o", PW);
    expect(db.get("studentUsernames/24PA1A0501")).toBeDefined();
  });
});

describe("resetStudentLoginPassword (S1)", () => {
  it("sets EXACTLY the supplied password, keeps a disabled login disabled, and changes no Firestore document", async () => {
    const { db, adminAuth, auth } = setup();
    const user = await auth.createUser({ email: "e@students.internal", password: "old-password" });
    await auth.updateUser(user.uid, { disabled: true });
    db.docs.set("colleges/c1/students/s1", { name: "A", uid: user.uid });
    const before = db.writeLog.length;

    await resetStudentLoginPassword(adminAuth, user.uid, "New-password-9");
    expect(auth.users.get(user.uid)).toMatchObject({ password: "New-password-9", disabled: true });
    expect(db.writeLog.length).toBe(before);
  });

  it("refuses a weak or missing password without touching Auth", async () => {
    const { adminAuth, auth } = setup();
    const user = await auth.createUser({ email: "e@students.internal", password: "old-password" });
    const calls = auth.calls.length;
    for (const bad of [undefined, "", "short", "Abcdef12 "]) {
      await expect(resetStudentLoginPassword(adminAuth, user.uid, bad as unknown as string)).rejects.toMatchObject({ status: 400 });
    }
    expect(auth.calls.length).toBe(calls);
    expect(auth.users.get(user.uid)?.password).toBe("old-password");
  });
});

describe("clearMustChangePassword (legacy hold)", () => {
  it("records when a held student changed it", async () => {
    const { db, firestore } = setup({ "colleges/c1/users/u1": { uid: "u1", mustChangePassword: true } });
    db.docs.set("colleges/c1/students/s1", { name: "A", uid: "u1", mustChangePassword: true });
    await clearMustChangePassword(firestore, "c1", "s1", "u1");
    expect(db.get("colleges/c1/students/s1")).toMatchObject({ mustChangePassword: false });
    expect(db.get("colleges/c1/students/s1")?.passwordChangedAt).toBeInstanceOf(Date);
    expect(db.get("colleges/c1/users/u1")?.mustChangePassword).toBe(false);
  });
});

describe("setStudentLoginActive", () => {
  it("disables and re-enables the Auth user and flags (never deletes) the profile - the student keeps their roll", async () => {
    const { db, firestore, adminAuth, auth } = setup();
    const u = await auth.createUser({ email: "e@x", password: "p" });
    db.docs.set(`colleges/c1/users/${u.uid}`, { uid: u.uid, isActive: true });
    db.docs.set("studentUsernames/R1", { uid: u.uid, collegeId: "c1", studentDocId: "s1", active: true });

    await setStudentLoginActive(firestore, adminAuth, "c1", u.uid, false);
    expect(auth.users.get(u.uid)?.disabled).toBe(true);
    expect(db.get(`colleges/c1/users/${u.uid}`)?.isActive).toBe(false);
    // A graduate still holds their roll number: the registry entry is NOT retired.
    expect(db.get("studentUsernames/R1")?.active).toBe(true);

    await setStudentLoginActive(firestore, adminAuth, "c1", u.uid, true);
    expect(auth.users.get(u.uid)?.disabled).toBe(false);
    expect(db.get(`colleges/c1/users/${u.uid}`)?.isActive).toBe(true);
  });

  it("tolerates an Auth user that no longer exists", async () => {
    const { firestore, adminAuth } = setup();
    await expect(setStudentLoginActive(firestore, adminAuth, "c1", "ghost", false)).resolves.toBeUndefined();
  });
});

describe("syncStudentRollChange - roll-change synchronisation (S4)", () => {
  const loginSeed = () => ({
    "colleges/c1/students/s1": { name: "A", rollNumber: "OLD1", rollNumberUpper: "OLD1", uid: "u1", loginEmail: "old1@students.internal", status: "REGULAR" },
    "colleges/c1/users/u1": { uid: "u1", email: "old1@students.internal" },
    "systemUsers/u1": { uid: "u1", email: "old1@students.internal" },
    "studentUsernames/OLD1": { rollKey: "old1", uid: "u1", collegeId: "c1", studentDocId: "s1", loginEmail: "old1@students.internal", active: true },
  });
  const before = { rollNumber: "OLD1", uid: "u1", loginEmail: "old1@students.internal", name: "A" };

  function withLogin() {
    const ctx = setup(loginSeed());
    ctx.auth.users.set("u1", { uid: "u1", email: "old1@students.internal", password: "pw-keep-1", disabled: false, customClaims: { role: "STUDENT", collegeId: "c1" } });
    return ctx;
  }

  it("moves everything to the new roll: registry, student doc, profile emails AND the Auth email; retires the old roll; keeps the password", async () => {
    const { db, firestore, adminAuth, auth } = withLogin();
    await syncStudentRollChange(firestore, adminAuth, "c1", "s1", before, "New-2", { labBatch: "Batch 1" });

    expect(db.get("colleges/c1/students/s1")).toMatchObject({ rollNumber: "New-2", rollNumberUpper: "NEW-2", labBatch: "Batch 1", loginEmail: "new2@students.internal" });
    expect(db.get("studentUsernames/NEW2")).toMatchObject({ uid: "u1", studentDocId: "s1", collegeId: "c1", loginEmail: "new2@students.internal", active: true, rollKey: "new2" });
    expect(db.get("studentUsernames/OLD1")).toMatchObject({ active: false });
    expect(db.get("colleges/c1/users/u1")?.email).toBe("new2@students.internal");
    expect(db.get("systemUsers/u1")?.email).toBe("new2@students.internal");
    expect(auth.users.get("u1")).toMatchObject({ email: "new2@students.internal", password: "pw-keep-1" });
  });

  it("the old roll is then FREE for another student (even in another college) and the new owner can get a login on it", async () => {
    const { db, firestore, adminAuth, auth } = withLogin();
    await syncStudentRollChange(firestore, adminAuth, "c1", "s1", before, "New-2");
    db.docs.set("colleges/c2/students/x1", { name: "Newcomer", rollNumber: "OLD1", status: "REGULAR" });
    const res = await provisionStudentLogin(firestore, adminAuth, "c2", "x1", student({ name: "Newcomer", rollNumber: "OLD1" }), "o", PW);
    expect(res.loginEmail).toBe("old1@students.internal"); // the email the first student used to hold - free again
    expect(auth.users.size).toBe(2);
  });

  it("refuses a roll another student already holds - in ANOTHER college too - changing nothing", async () => {
    const { db, firestore, adminAuth, auth } = withLogin();
    db.docs.set("colleges/c2/students/x1", { name: "Other College Student" });
    db.docs.set("studentUsernames/TAKEN", { collegeId: "c2", studentDocId: "x1", active: true, createdAt: new Date() });
    const err = await syncStudentRollChange(firestore, adminAuth, "c1", "s1", before, "ta-ken").catch((e) => e);
    expect(err).toBeInstanceOf(StudentLoginError);
    expect((err as Error).message).not.toContain("Other College Student");
    expect(db.get("colleges/c1/students/s1")?.rollNumber).toBe("OLD1");
    expect(auth.users.get("u1")?.email).toBe("old1@students.internal");
    expect(db.get("studentUsernames/OLD1")?.active).toBe(true);
  });

  it("for a student with no login only the document and the registry change - Auth is never called", async () => {
    const { db, firestore, adminAuth, auth } = setup({ "colleges/c1/students/s1": { name: "A", rollNumber: "", status: "REGULAR" } });
    await syncStudentRollChange(firestore, adminAuth, "c1", "s1", { rollNumber: "", uid: undefined, loginEmail: undefined, name: "A" }, "R7");
    expect(db.get("colleges/c1/students/s1")).toMatchObject({ rollNumber: "R7", rollNumberUpper: "R7" });
    expect(db.get("studentUsernames/R7")).toMatchObject({ collegeId: "c1", studentDocId: "s1", active: true });
    expect(db.get("studentUsernames/R7")).not.toHaveProperty("uid");
    expect(auth.calls).toHaveLength(0);
  });

  it("a casing / punctuation-only change keeps the same identity active and the Auth email untouched", async () => {
    const { db, firestore, adminAuth, auth } = setup({
      "colleges/c1/students/s1": { name: "A", rollNumber: "r1", uid: "u1", loginEmail: "r1@students.internal", status: "REGULAR" },
      "studentUsernames/R1": { uid: "u1", collegeId: "c1", studentDocId: "s1", loginEmail: "r1@students.internal", active: true },
    });
    auth.users.set("u1", { uid: "u1", email: "r1@students.internal", password: "pw", disabled: false, customClaims: {} });
    await syncStudentRollChange(firestore, adminAuth, "c1", "s1", { rollNumber: "r1", uid: "u1", loginEmail: "r1@students.internal", name: "A" }, "R-1");
    expect(db.get("studentUsernames/R1")).toMatchObject({ active: true, loginEmail: "r1@students.internal" });
    expect(db.get("colleges/c1/students/s1")).toMatchObject({ rollNumber: "R-1" });
    expect(auth.calls.filter((c) => c.fn === "updateUser")).toHaveLength(0);
  });

  it("a legacy account (punctuated email, legacy lookup) is migrated onto the normalised identity", async () => {
    const { db, firestore, adminAuth, auth } = setup({
      "colleges/c1/students/s1": { name: "A", rollNumber: "24-PA1A0501", uid: "u1", loginEmail: "24-pa1a0501@students.internal", status: "REGULAR" },
      "studentUsernames/24-PA1A0501": { uid: "u1", loginEmail: "24-pa1a0501@students.internal" }, // legacy: no studentDocId
    });
    auth.users.set("u1", { uid: "u1", email: "24-pa1a0501@students.internal", password: "pw", disabled: false, customClaims: {} });
    await syncStudentRollChange(firestore, adminAuth, "c1", "s1", { rollNumber: "24-PA1A0501", uid: "u1", loginEmail: "24-pa1a0501@students.internal", name: "A" }, "24PA1A0599");
    expect(db.get("studentUsernames/24-PA1A0501")).toMatchObject({ active: false }); // retired via its uid
    expect(db.get("studentUsernames/24PA1A0599")).toMatchObject({ uid: "u1", loginEmail: "24pa1a0599@students.internal" });
    expect(auth.users.get("u1")?.email).toBe("24pa1a0599@students.internal");
  });

  it("ROLLBACK: if the Firestore batch fails after the Auth email changed, the email is restored and the claim released", async () => {
    const { db, firestore, adminAuth, auth } = withLogin();
    const realBatch = db.batch.bind(db);
    db.batch = () => { const b = realBatch(); b.commit = async () => { throw new Error("firestore unavailable"); }; return b; };
    await expect(syncStudentRollChange(firestore, adminAuth, "c1", "s1", before, "New-2")).rejects.toThrow("firestore unavailable");
    expect(auth.users.get("u1")?.email).toBe("old1@students.internal");
    expect(db.get("studentUsernames/NEW2")).toBeUndefined();
    expect(db.get("studentUsernames/OLD1")?.active).toBe(true);
    expect(db.get("colleges/c1/students/s1")?.rollNumber).toBe("OLD1");
  });

  it("ROLLBACK: if the Auth email change fails, nothing is claimed and nothing changes", async () => {
    const { db, firestore, adminAuth, auth } = withLogin();
    auth.failNext.updateUser = new Error("auth hiccup");
    await expect(syncStudentRollChange(firestore, adminAuth, "c1", "s1", before, "New-2")).rejects.toThrow("auth hiccup");
    expect(db.get("studentUsernames/NEW2")).toBeUndefined();
    expect(db.get("colleges/c1/students/s1")?.rollNumber).toBe("OLD1");
  });

  it("an Auth email that already belongs to another account is a clean 409 and nothing is left claimed", async () => {
    const { db, firestore, adminAuth, auth } = withLogin();
    auth.users.set("stranger", { uid: "stranger", email: "new2@students.internal", password: "x", disabled: false, customClaims: {} });
    await expect(syncStudentRollChange(firestore, adminAuth, "c1", "s1", before, "New-2")).rejects.toMatchObject({ status: 409 });
    expect(db.get("studentUsernames/NEW2")).toBeUndefined();
    expect(auth.users.get("u1")?.email).toBe("old1@students.internal");
  });

  it("a roll with no letters or digits is refused", async () => {
    const { firestore, adminAuth } = withLogin();
    await expect(syncStudentRollChange(firestore, adminAuth, "c1", "s1", before, "###")).rejects.toMatchObject({ status: 400 });
  });
});
