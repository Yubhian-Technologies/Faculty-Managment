import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAuth, FakeFirestore, fakeFs } from "@/lib/testing/fakeFirestore.testutil";

// The Auth side is an in-memory fake too - nothing here can reach a real project.
const h = vi.hoisted(() => ({ auth: null as unknown as FakeAuth }));
vi.mock("@/lib/firebase/authRest", () => ({
  createFirebaseUser: async (email: string, password: string, displayName: string) =>
    (await h.auth.createUser({ email, password, displayName })).uid,
}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminAuth: async () => h.auth }));

import { linkFacultyToExistingAccount, provisionFacultyFromOffer } from "./facultyProvisioning";

const seed = (): Record<string, Record<string, unknown>> => ({
  "colleges/c1/offerLetters/o1": { candidateId: "cand1", designation: "Professor", department: "CSE", status: "ACCEPTED" },
  "colleges/c1/candidates/cand1": { name: "Dr. Priya Nair", email: "priya@example.com", phone: "9999999999" },
  "colleges/c1/offerLetters/o2": { candidateId: "cand2", designation: "Lecturer", department: "ECE", status: "ACCEPTED" },
  "colleges/c1/candidates/cand2": { name: "Dr. Ravi", email: "ravi@example.com", phone: "8888888888" },
  "colleges/c1/users/u9": { name: "Existing Login", email: "priya@vit.edu" },
});

const facultyDocs = (db: FakeFirestore) =>
  [...db.docs.entries()].filter(([p]) => /^colleges\/c1\/facultyMembers\/[^/]+$/.test(p)).map(([, d]) => d);

beforeEach(() => {
  h.auth = new FakeAuth();
});

describe("provisionFacultyFromOffer", () => {
  it("creates the login and every document, writing the candidate name to legalName only (new name model)", async () => {
    const { db, firestore } = fakeFs(seed());
    const res = await provisionFacultyFromOffer(firestore, "c1", "o1", { collegeEmail: "priya@vit.edu", password: "password1" });
    expect(res).toMatchObject({ status: "created", employeeId: "EMP0001", generatedPassword: "password1" });

    const [faculty] = facultyDocs(db);
    expect(faculty.legalName).toBe("Dr. Priya Nair");
    expect("name" in faculty).toBe(false);
    expect("nameAsPerPan" in faculty).toBe(false);
    expect(faculty).toMatchObject({ employeeId: "EMP0001", collegeEmail: "priya@vit.edu", status: "ACTIVE", department: "CSE" });

    const uid = faculty.userUid as string;
    expect(h.auth.users.get(uid)).toMatchObject({ email: "priya@vit.edu", password: "password1" });
    expect(db.get(`colleges/c1/users/${uid}`)).toMatchObject({ role: "PANEL_MEMBER", name: "Dr. Priya Nair", isActive: true });
    expect(db.get(`systemUsers/${uid}`)).toMatchObject({ role: "PANEL_MEMBER", collegeId: "c1" });
  });

  it("generates a password when none is supplied", async () => {
    const { firestore } = fakeFs(seed());
    const res = await provisionFacultyFromOffer(firestore, "c1", "o1");
    expect(res.status).toBe("created");
    if (res.status === "created") expect(res.generatedPassword.length).toBeGreaterThanOrEqual(12);
  });

  it("a failed write rolls the Auth user back and leaves no partial documents - and the retry then works", async () => {
    const { db, firestore } = fakeFs(seed());
    const realBatch = db.batch.bind(db);
    db.batch = () => ({ set() { return this; }, commit: async () => { throw new Error("commit failed"); } }) as never;

    await expect(provisionFacultyFromOffer(firestore, "c1", "o1", { collegeEmail: "priya@vit.edu", password: "pw" })).rejects.toThrow("commit failed");
    expect(h.auth.users.size).toBe(0);
    expect(facultyDocs(db)).toHaveLength(0);
    expect(db.get("systemUsers/uid1")).toBeUndefined();

    db.batch = realBatch;
    const retry = await provisionFacultyFromOffer(firestore, "c1", "o1", { collegeEmail: "priya@vit.edu", password: "pw" });
    expect(retry.status).toBe("created");
    expect(h.auth.users.size).toBe(1);
  });

  it("an email that belongs to a real, in-use account is reported as email_taken and the account is untouched", async () => {
    const { db, firestore } = fakeFs({ ...seed(), "systemUsers/owner": { role: "HOD" } });
    h.auth.users.set("owner", { uid: "owner", email: "priya@vit.edu", password: "theirs", disabled: false, customClaims: { role: "HOD" } });
    const res = await provisionFacultyFromOffer(firestore, "c1", "o1", { collegeEmail: "priya@vit.edu", password: "pw" });
    expect(res).toEqual({ status: "email_taken" });
    expect(h.auth.users.get("owner")?.password).toBe("theirs");
    expect(facultyDocs(db)).toHaveLength(0);
  });

  it("an orphan Auth user left by an older failed run is reused instead of blocking forever", async () => {
    const { db, firestore } = fakeFs(seed());
    h.auth.users.set("orphan", { uid: "orphan", email: "priya@vit.edu", password: "old", disabled: false, customClaims: {} });
    const res = await provisionFacultyFromOffer(firestore, "c1", "o1", { collegeEmail: "priya@vit.edu", password: "pw" });
    expect(res.status).toBe("created");
    expect(facultyDocs(db)[0].userUid).toBe("orphan");
    expect(h.auth.users.get("orphan")?.password).toBe("pw");
  });

  it("is idempotent for a candidate who already has a faculty record", async () => {
    const { firestore } = fakeFs({ ...seed(), "colleges/c1/facultyMembers/f1": { candidateId: "cand1", employeeId: "EMP0001" } });
    expect(await provisionFacultyFromOffer(firestore, "c1", "o1", { collegeEmail: "priya@vit.edu", password: "pw" })).toEqual({ status: "already_exists", facultyId: "f1" });
    expect(h.auth.users.size).toBe(0);
  });

  it("reports not_found / no_email without creating anything", async () => {
    const { firestore } = fakeFs({ ...seed(), "colleges/c1/candidates/cand2": { name: "No Email" } });
    expect(await provisionFacultyFromOffer(firestore, "c1", "missing")).toEqual({ status: "not_found" });
    expect(await provisionFacultyFromOffer(firestore, "c1", "o2")).toEqual({ status: "no_email" });
    expect(h.auth.users.size).toBe(0);
  });

  it("employee ids continue after the highest in use and never repeat one a deleted member held", async () => {
    const { firestore } = fakeFs({ ...seed(), "colleges/c1/facultyMembers/old": { employeeId: "EMP0005", candidateId: "gone" } });
    const res = await provisionFacultyFromOffer(firestore, "c1", "o1", { collegeEmail: "a@vit.edu", password: "pw" });
    expect(res).toMatchObject({ status: "created", employeeId: "EMP0006" });
  });

  it("two provisionings at the same moment get different employee ids (the old count+1 race)", async () => {
    const { db, firestore } = fakeFs(seed());
    const [a, b] = await Promise.all([
      provisionFacultyFromOffer(firestore, "c1", "o1", { collegeEmail: "a@vit.edu", password: "pw" }),
      provisionFacultyFromOffer(firestore, "c1", "o2", { collegeEmail: "b@vit.edu", password: "pw" }),
    ]);
    expect(a.status).toBe("created");
    expect(b.status).toBe("created");
    const ids = facultyDocs(db).map((f) => f.employeeId);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("linkFacultyToExistingAccount", () => {
  it("links the offer to the existing login: legalName set, id from the counter, no new Auth user", async () => {
    const { db, firestore } = fakeFs(seed());
    const res = await linkFacultyToExistingAccount(firestore, "c1", "o1", "u9");
    expect(res).toMatchObject({ status: "linked", employeeId: "EMP0001", assignedEmail: "priya@vit.edu" });
    const [faculty] = facultyDocs(db);
    expect(faculty).toMatchObject({ legalName: "Dr. Priya Nair", userUid: "u9", linkedExistingAccount: true });
    expect("name" in faculty).toBe(false);
    expect("nameAsPerPan" in faculty).toBe(false);
    expect(h.auth.calls).toHaveLength(0);
  });

  it("reports an unknown login, and is idempotent", async () => {
    const { firestore } = fakeFs(seed());
    expect(await linkFacultyToExistingAccount(firestore, "c1", "o1", "nobody")).toEqual({ status: "existing_user_not_found" });
    expect((await linkFacultyToExistingAccount(firestore, "c1", "o1", "u9")).status).toBe("linked");
    expect((await linkFacultyToExistingAccount(firestore, "c1", "o1", "u9")).status).toBe("already_exists");
  });
});
