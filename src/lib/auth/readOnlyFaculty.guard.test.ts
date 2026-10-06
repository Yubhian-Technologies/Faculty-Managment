import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The REAL guards (requireCollegeMember -> requireRole -> liveRoles) with a fake
// Firestore and fake request context, proving the read-only rule for RESIGNED /
// RETIRED faculty and - just as important - that nothing changes for anyone else.

const cookieJar = new Map<string, string>();
const reqHeaders = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (cookieJar.has(n) ? { value: cookieJar.get(n)! } : undefined) }),
  headers: async () => ({ get: (n: string) => reqHeaders.get(n.toLowerCase()) ?? null }),
}));

const store = new Map<string, Record<string, unknown>>();           // "colleges/c1/users/u1" -> doc
const reads = { users: 0, faculty: 0 };
const failFaculty = { on: false };
function docRef(p: string) {
  return {
    get: async () => { if (p.includes("/users/")) reads.users++; return { exists: store.has(p), data: () => store.get(p) }; },
    collection: (sub: string) => colRef(`${p}/${sub}`),
  };
}
function colRef(p: string) {
  return {
    doc: (id: string) => docRef(`${p}/${id}`),
    where: (field: string, _op: string, value: unknown) => ({
      limit: () => ({
        get: async () => {
          reads.faculty++;
          if (failFaculty.on) throw new Error("firestore unavailable");
          const docs = [...store.entries()].filter(([k, v]) => k.startsWith(`${p}/`) && v[field] === value).map(([k, v]) => ({ id: k, data: () => v }));
          return { empty: docs.length === 0, docs };
        },
      }),
    }),
  };
}
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => ({ collection: (n: string) => colRef(n) }) }));
vi.mock("@/lib/leave/roleDelegation", () => ({ activeDelegatedRoles: async () => ({ roles: [] }) }));

import { signSession } from "./sessionToken";
import { requireCollegeMember, requireRole } from "./verifySession";
import { forgetHeldRoles } from "./liveRoles";

const HOUR = 3600;
const C = "c1";
const sess = async (over: Record<string, unknown> = {}) =>
  cookieJar.set("fms-session", await signSession({ uid: "u1", email: "x@y.z", role: "PANEL_MEMBER", roles: ["HOD", "PANEL_MEMBER"], collegeId: C, exp: Math.floor(Date.now() / 1000) + HOUR, ...over }));
const request = (method: string, path: string) => { reqHeaders.set("x-fms-method", method); reqHeaders.set("x-fms-path", path); };
const setFaculty = (status: string) => store.set(`colleges/${C}/facultyMembers/f1`, { userUid: "u1", status });
const setUser = (over: Record<string, unknown> = {}) =>
  store.set(`colleges/${C}/users/u1`, { role: "PANEL_MEMBER", seatRoles: ["HOD"], isActive: true, ...over });

async function allowed(roles: string[]): Promise<boolean> {
  try { await requireCollegeMember(...roles); return true; } catch { return false; }
}

beforeEach(async () => {
  process.env.SESSION_SECRET = "test-secret";
  cookieJar.clear(); reqHeaders.clear(); store.clear();
  reads.users = 0; reads.faculty = 0; failFaculty.on = false;
  forgetHeldRoles(C, "u1");
  vi.spyOn(console, "error").mockImplementation(() => {});
  setUser();
  await sess();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete process.env.READ_ONLY_FACULTY_COLLEGES; });

describe("every college, no switch", () => {
  it("a RESIGNED faculty with a seat is read-only in ANY college id - there is no env variable that can turn it off", async () => {
    process.env.READ_ONLY_FACULTY_COLLEGES = "some-other-college"; // the old switch is ignored
    setFaculty("RESIGNED");
    request("POST", "/api/college/students");
    expect(await allowed(["HOD"])).toBe(false);
    expect(await allowed(["PANEL_MEMBER"])).toBe(false);
    expect(reads.faculty).toBeGreaterThan(0);
  });
});

describe("ACTIVE faculty: unchanged", () => {
  it("keeps every role/seat and can write", async () => {
    setFaculty("ACTIVE");
    request("POST", "/api/college/students");
    expect(await allowed(["HOD"])).toBe(true);
    expect(await allowed(["PANEL_MEMBER"])).toBe(true);
  });
  it.each(["ON_LEAVE", "RETAINERSHIP", "INTERVIEW_DONE"])("%s is not read-only", async (status) => {
    setFaculty(status);
    request("POST", "/api/college/attendance/check-in");
    expect(await allowed(["PANEL_MEMBER"])).toBe(true);
  });
  it("a login with no linked faculty record is not read-only", async () => {
    request("POST", "/api/college/students");
    expect(await allowed(["PANEL_MEMBER"])).toBe(true);
  });
});

describe("RESIGNED / RETIRED faculty: read-only", () => {
  

  it.each(["RESIGNED", "RETIRED"])("%s can read their own allowed data as a plain faculty member", async (status) => {
    setFaculty(status);
    request("GET", "/api/college/faculty/me");
    const s = await requireCollegeMember("PANEL_MEMBER", "HOD", "PRINCIPAL");
    expect(s.role).toBe("PANEL_MEMBER");           // not HOD, even though the seat is on the record
    expect(s.roles).toEqual(["PANEL_MEMBER"]);
    expect(s.realRole).toBe("PANEL_MEMBER");
  });

  it("is denied EVERY write method on any route, including ones that accept PANEL_MEMBER", async () => {
    setFaculty("RESIGNED");
    for (const [m, p] of [
      ["POST", "/api/college/attendance/check-in"], ["POST", "/api/college/attendance/check-out"], ["POST", "/api/college/attendance/face-registration"],
      ["PATCH", "/api/college/faculty/me"], ["PATCH", "/api/college/users/me/photo"], ["POST", "/api/college/internal-exam-marks"],
      ["POST", "/api/college/timetable-slots"], ["POST", "/api/college/sections"], ["POST", "/api/college/students"],
      ["PATCH", "/api/college/notifications"], ["POST", "/api/leave/applications"], ["DELETE", "/api/college/teaching-assignments"],
      ["PUT", "/api/leave/profile"], ["POST", "/api/upload/profile-photo"],
    ] as const) {
      request(m, p);
      expect(await allowed(["PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE"]), `${m} ${p}`).toBe(false);
    }
  });

  it("is denied reads that are not their own history (students, sections, other people)", async () => {
    setFaculty("RESIGNED");
    for (const p of ["/api/college/students", "/api/college/sections", "/api/college/faculty", "/api/college/timetable-slots", "/api/college/departments"]) {
      request("GET", p);
      expect(await allowed(["PANEL_MEMBER", "HOD", "PRINCIPAL"]), p).toBe(false);
    }
  });

  it("a spoofed read header cannot be sent by the client: only what the proxy stamped counts; missing headers deny", async () => {
    setFaculty("RESIGNED");
    // no x-fms-* headers at all (script / no request context)
    expect(await allowed(["PANEL_MEMBER"])).toBe(false);
  });

  it("a multi-seat holder who resigned holds no authority at all", async () => {
    store.set(`colleges/${C}/users/u1`, { role: "PANEL_MEMBER", seatRoles: ["HOD", "VICE_PRINCIPAL", "ACADEMICS"], isActive: true });
    setFaculty("RETIRED");
    await sess({ roles: ["VICE_PRINCIPAL", "HOD", "ACADEMICS", "PANEL_MEMBER"] });
    for (const m of ["GET", "POST"]) {
      request(m, "/api/college/students");
      expect(await allowed(["HOD", "VICE_PRINCIPAL", "ACADEMICS", "PRINCIPAL"]), m).toBe(false);
    }
    request("GET", "/api/college/faculty/me");
    const s = await requireRole("VICE_PRINCIPAL", "HOD", "PANEL_MEMBER");
    expect(s.role).toBe("PANEL_MEMBER");
  });

  it("does not touch the stored account: the login doc is read, never written (no isActive/role/seat change)", async () => {
    const before = JSON.stringify(store.get(`colleges/${C}/users/u1`));
    setFaculty("RESIGNED");
    request("GET", "/api/college/faculty/me");
    await requireCollegeMember("PANEL_MEMBER");
    expect(JSON.stringify(store.get(`colleges/${C}/users/u1`))).toBe(before);
    expect([...store.keys()].filter((k) => k.includes("/users/")).length).toBe(1);
  });

  it("reinstating (status back to ACTIVE) restores normal access with no other change - and no seat is added back", async () => {
    setFaculty("RESIGNED");
    request("POST", "/api/college/students");
    expect(await allowed(["PANEL_MEMBER", "HOD"])).toBe(false);
    setFaculty("ACTIVE");
    forgetHeldRoles(C, "u1");                       // (otherwise it self-heals within the 20 s cache)
    expect(await allowed(["PANEL_MEMBER"])).toBe(true);
    // the seat list on the login record is whatever the seat flow left it as - the guard never re-adds anything
    expect(store.get(`colleges/${C}/users/u1`)!.seatRoles).toEqual(["HOD"]);
  });
});

describe("only faculty-capable logins are ever looked up", () => {
  it("a College Office login costs no faculty lookup even ", async () => {
    store.set(`colleges/${C}/users/u1`, { role: "COLLEGE_OFFICE", seatRoles: [], isActive: true });
    await sess({ role: "COLLEGE_OFFICE", roles: ["COLLEGE_OFFICE"] });
    request("POST", "/api/college/students");
    expect(await allowed(["COLLEGE_OFFICE"])).toBe(true);
    expect(reads.faculty).toBe(0);
  });
  it("an inactive account is still simply denied (existing behaviour), with no lookup", async () => {
    setUser({ isActive: false });
    request("GET", "/api/college/faculty/me");
    expect(await allowed(["PANEL_MEMBER"])).toBe(false);
    expect(reads.faculty).toBe(0);
  });
});

describe("read cost", () => {
  it("one faculty lookup per person per 20 s window, however many requests", async () => {
    setFaculty("ACTIVE");
    request("GET", "/api/college/faculty/me");
    for (let i = 0; i < 10; i++) await requireCollegeMember("PANEL_MEMBER");
    expect(reads.faculty).toBe(1);
    expect(reads.users).toBe(1);
  });
});

describe("when the status lookup fails (fail closed)", () => {
  

  it("with no earlier answer: writes are denied, reads carry on as before", async () => {
    setFaculty("ACTIVE");
    failFaculty.on = true;
    request("POST", "/api/college/students");
    expect(await allowed(["PANEL_MEMBER", "HOD"])).toBe(false);
    forgetHeldRoles(C, "u1");
    request("GET", "/api/college/students");
    expect(await allowed(["PANEL_MEMBER", "HOD"])).toBe(true);
  });

  it("reuses a recent answer through a short outage (a resigned person stays read-only)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T10:00:00Z"));
    await sess({ exp: Math.floor(Date.now() / 1000) + HOUR });
    setFaculty("RESIGNED");
    request("POST", "/api/college/students");
    expect(await allowed(["PANEL_MEMBER", "HOD"])).toBe(false);   // YES cached
    vi.setSystemTime(new Date("2026-10-05T10:01:00Z"));            // past the 20 s TTL, within 5 min
    failFaculty.on = true;
    expect(await allowed(["PANEL_MEMBER", "HOD"])).toBe(false);   // still read-only from the stale answer
    request("GET", "/api/college/faculty/me");
    expect((await requireCollegeMember("PANEL_MEMBER")).role).toBe("PANEL_MEMBER");
  });

  it("an active faculty's earlier answer is reused too (no lock-out of active faculty)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T10:00:00Z"));
    await sess({ exp: Math.floor(Date.now() / 1000) + HOUR });
    setFaculty("ACTIVE");
    request("POST", "/api/college/students");
    expect(await allowed(["PANEL_MEMBER"])).toBe(true);
    vi.setSystemTime(new Date("2026-10-05T10:01:00Z"));
    failFaculty.on = true;
    expect(await allowed(["PANEL_MEMBER"])).toBe(true);
  });
});
