import { describe, it, expect } from "vitest";
import { fakeAuth, fakeFs } from "@/lib/testing/fakeFirestore.testutil";
import { withAuthUser, type AuthAdminLike } from "@/lib/firebase/withAuthUser";

const EMAIL = "new.person@college.edu";

function setup(seed: Record<string, Record<string, unknown>> = {}) {
  const fs = fakeFs(seed);
  const { auth } = fakeAuth();
  const signedIn = new Set<string>();

  const createUser = async (email: string, password: string, displayName: string) => (await auth.createUser({ email, password, displayName })).uid;
  const admin: AuthAdminLike = {
    getUserByEmail: async (email) => {
      const u = await auth.getUserByEmail(email);
      return { uid: u.uid, customClaims: u.customClaims, metadata: { lastSignInTime: signedIn.has(u.uid) ? "2026-01-01" : null } };
    },
    updateUser: (uid, props) => auth.updateUser(uid, props),
    deleteUser: (uid) => auth.deleteUser(uid),
  };
  const run = <T>(work: (uid: string) => Promise<T>) =>
    withAuthUser({ email: EMAIL, password: "pw-1", displayName: "New Person", db: fs.firestore, createUser, getAdminAuth: async () => admin }, work);
  return { ...fs, auth, signedIn, run };
}

describe("withAuthUser (F2: rollback-safe provisioning)", () => {
  it("creates the Auth user, runs the work with its uid and returns the result", async () => {
    const { auth, run } = setup();
    const out = await run(async (uid) => `done:${uid}`);
    expect(out).toMatch(/^done:uid/);
    expect(auth.users.size).toBe(1);
  });

  it("when the Firestore work fails, the Auth user THIS call created is deleted and the error surfaces", async () => {
    const { auth, run } = setup();
    await expect(run(async () => { throw new Error("batch failed"); })).rejects.toThrow("batch failed");
    expect(auth.users.size).toBe(0); // no orphan to block the retry
    expect(auth.calls.filter((c) => c.fn === "deleteUser")).toHaveLength(1);
  });

  it("the retry after a rolled-back failure succeeds (the original bug: 'email already exists' forever)", async () => {
    const { auth, run } = setup();
    await expect(run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(run(async (uid) => uid)).resolves.toMatch(/^uid/);
    expect(auth.users.size).toBe(1);
  });

  it("a cleanup failure never hides the real error", async () => {
    const { auth, run } = setup();
    auth.failNext.deleteUser = new Error("delete failed");
    await expect(run(async () => { throw new Error("the real problem"); })).rejects.toThrow("the real problem");
  });

  it("a creation error that is not 'email exists' is re-thrown and runs no work", async () => {
    const { auth, run } = setup();
    auth.failNext.createUser = new Error("quota");
    let ran = false;
    await expect(run(async () => { ran = true; })).rejects.toThrow("quota");
    expect(ran).toBe(false);
  });

  it("reuses a genuine orphan (never signed in, no claims, no profile) with the new password", async () => {
    const { auth, run } = setup();
    auth.users.set("orphan1", { uid: "orphan1", email: EMAIL, password: "old", disabled: true, customClaims: {} });
    await expect(run(async (uid) => uid)).resolves.toBe("orphan1");
    expect(auth.users.get("orphan1")).toMatchObject({ password: "pw-1", disabled: false });
  });

  it("a reused orphan is NOT deleted when the work then fails (it was not ours)", async () => {
    const { auth, run } = setup();
    auth.users.set("orphan1", { uid: "orphan1", email: EMAIL, password: "old", disabled: false, customClaims: {} });
    await expect(run(async () => { throw new Error("work failed"); })).rejects.toThrow("work failed");
    expect(auth.users.has("orphan1")).toBe(true);
  });

  it("never hijacks an account that has a systemUsers profile", async () => {
    const { auth, run } = setup({ "systemUsers/owner1": { role: "PRINCIPAL" } });
    auth.users.set("owner1", { uid: "owner1", email: EMAIL, password: "theirs", disabled: false, customClaims: {} });
    await expect(run(async () => "x")).rejects.toMatchObject({ code: "auth/email-already-exists" });
    expect(auth.users.get("owner1")?.password).toBe("theirs");
  });

  it("never hijacks an account that has custom claims", async () => {
    const { auth, run } = setup();
    auth.users.set("u9", { uid: "u9", email: EMAIL, password: "theirs", disabled: false, customClaims: { role: "HOD" } });
    await expect(run(async () => "x")).rejects.toMatchObject({ code: "auth/email-already-exists" });
    expect(auth.users.get("u9")?.password).toBe("theirs");
  });

  it("never hijacks an account that has signed in", async () => {
    const { auth, signedIn, run } = setup();
    auth.users.set("u8", { uid: "u8", email: EMAIL, password: "theirs", disabled: false, customClaims: {} });
    signedIn.add("u8");
    await expect(run(async () => "x")).rejects.toMatchObject({ code: "auth/email-already-exists" });
    expect(auth.users.get("u8")?.password).toBe("theirs");
  });
});
