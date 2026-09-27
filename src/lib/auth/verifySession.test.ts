import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// verifySession() reads the fms-session cookie via next/headers' cookies(),
// which only works inside a real Next.js request. Fake just enough of it to
// exercise the guard logic - a Map keyed by cookie name.
const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
  }),
}));

// liveRoles.ts reads the caller's current role/seatRoles/isActive straight off
// Firestore (colleges/{id}/users/{uid} or systemUsers/{uid}) as ground truth.
// Fake the two shapes verifySession's guards actually query - collection/doc
// for systemUsers, collection/doc/collection/doc for the college-scoped path.
const fakeDocs = new Map<string, Record<string, unknown>>();
function fakeDocRef(path: string) {
  return {
    get: async () => ({ exists: fakeDocs.has(path), data: () => fakeDocs.get(path) }),
    collection: (sub: string) => fakeCollectionRef(`${path}/${sub}`),
  };
}
function fakeCollectionRef(path: string) {
  return { doc: (id: string) => fakeDocRef(`${path}/${id}`) };
}
vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => ({ collection: (name: string) => fakeCollectionRef(name) }),
}));

import { signSession } from "./sessionToken";
import { requireRole, requireSuperAdmin, verifySession } from "./verifySession";

const HOUR = 60 * 60;
const future = () => Math.floor(Date.now() / 1000) + HOUR;

async function setSessionCookie(payload: Record<string, unknown>) {
  cookieJar.set("fms-session", await signSession(payload));
}

beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret";
  cookieJar.clear();
  fakeDocs.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verifySession", () => {
  it("returns null with no cookie", async () => {
    expect(await verifySession()).toBeNull();
  });

  it("returns null once the session has expired", async () => {
    await setSessionCookie({ uid: "u1", role: "HOD", collegeId: "c1", exp: Math.floor(Date.now() / 1000) - 10 });
    expect(await verifySession()).toBeNull();
  });

  it("returns the payload for a still-valid session", async () => {
    await setSessionCookie({ uid: "u1", role: "HOD", collegeId: "c1", exp: future() });
    expect((await verifySession())?.role).toBe("HOD");
  });
});

describe("requireRole", () => {
  it("throws UNAUTHORIZED with no session at all", async () => {
    await expect(requireRole("HOD")).rejects.toThrow("UNAUTHORIZED");
  });

  it("throws UNAUTHORIZED when the role isn't in the allowed list", async () => {
    await setSessionCookie({ uid: "u-not-allowed", role: "PANEL_MEMBER", collegeId: "c1", exp: future() });
    fakeDocs.set("colleges/c1/users/u-not-allowed", { role: "PANEL_MEMBER", isActive: true });
    await expect(requireRole("PRINCIPAL")).rejects.toThrow("UNAUTHORIZED");
  });

  it("passes through a role the live Firestore doc still grants", async () => {
    await setSessionCookie({ uid: "u-live-grant", role: "HOD", collegeId: "c1", exp: future() });
    fakeDocs.set("colleges/c1/users/u-live-grant", { role: "HOD", isActive: true });
    const session = await requireRole("HOD", "PRINCIPAL");
    expect(session.role).toBe("HOD");
  });

  // The whole point of the live re-check: a cookie minted before a
  // deactivation/demotion must stop working within the cache window, not
  // only once the 24h cookie naturally expires. Each test below uses its own
  // uid - liveRoles.ts caches live lookups for 20s keyed by collegeId/uid, so
  // reusing one across tests in this file would silently read a previous
  // test's cached result instead of exercising this fixture.
  it("rejects a session whose live Firestore doc has since been deactivated", async () => {
    await setSessionCookie({ uid: "u-deactivated", role: "HOD", collegeId: "c1", exp: future() });
    fakeDocs.set("colleges/c1/users/u-deactivated", { role: "HOD", isActive: false });
    await expect(requireRole("HOD")).rejects.toThrow("UNAUTHORIZED");
  });

  it("rejects a session whose live Firestore doc has since been demoted", async () => {
    await setSessionCookie({ uid: "u-demoted", role: "HOD", collegeId: "c1", exp: future() });
    fakeDocs.set("colleges/c1/users/u-demoted", { role: "PANEL_MEMBER", isActive: true });
    await expect(requireRole("HOD")).rejects.toThrow("UNAUTHORIZED");
  });

  it("evaluates a faculty member holding an HOD seat as HOD", async () => {
    await setSessionCookie({ uid: "u-hod-seat", role: "PANEL_MEMBER", collegeId: "c1", exp: future() });
    fakeDocs.set("colleges/c1/users/u-hod-seat", { role: "PANEL_MEMBER", seatRoles: ["HOD"], isActive: true });
    const session = await requireRole("HOD", "PANEL_MEMBER");
    expect(session.role).toBe("HOD");
  });

  it("stops granting a seat the instant it's revoked live, even mid-cookie-lifetime", async () => {
    await setSessionCookie({ uid: "u-seat-revoked", role: "PANEL_MEMBER", roles: ["HOD", "PANEL_MEMBER"], collegeId: "c1", exp: future() });
    fakeDocs.set("colleges/c1/users/u-seat-revoked", { role: "PANEL_MEMBER", seatRoles: [], isActive: true });
    await expect(requireRole("HOD")).rejects.toThrow("UNAUTHORIZED");
  });
});

describe("requireSuperAdmin", () => {
  it("rejects a session whose primary role isn't SUPER_ADMIN", async () => {
    await setSessionCookie({ uid: "u-not-admin", role: "PRINCIPAL", collegeId: "c1", exp: future() });
    await expect(requireSuperAdmin()).rejects.toThrow("UNAUTHORIZED");
  });

  // Distinct uids per test - see the requireRole block above for why.
  it("rejects a Super Admin whose systemUsers doc no longer says so", async () => {
    await setSessionCookie({ uid: "u-revoked-admin", role: "SUPER_ADMIN", collegeId: "", locationId: "", exp: future() });
    fakeDocs.set("systemUsers/u-revoked-admin", { role: "PRINCIPAL", isActive: true });
    await expect(requireSuperAdmin()).rejects.toThrow("UNAUTHORIZED");
  });

  it("passes for a live Super Admin", async () => {
    await setSessionCookie({ uid: "u-live-admin", role: "SUPER_ADMIN", collegeId: "", locationId: "", exp: future() });
    fakeDocs.set("systemUsers/u-live-admin", { role: "SUPER_ADMIN", isActive: true });
    const session = await requireSuperAdmin();
    expect(session.role).toBe("SUPER_ADMIN");
  });
});
