import { afterEach, describe, expect, it, vi } from "vitest";
import { FACULTY_OWNED_MIRRORED_KEYS, FACULTY_PERSONAL_KEYS, isSingleSourceCollege, mergeFacultyWithLogin, singleSourceBlockFor, singleSourceColleges } from "@/lib/faculty/singleSource";
import { buildPersonalDetailsUpdate } from "@/lib/firestore/personalDetails";

// R3 - which copy wins when the Super-Admin user list/detail merges a faculty record with its login.
// The switch keeps every other college byte-identical.

const lifted = { legalName: "Dr Real Name", profilePhotoUrl: "faculty.jpg", employeeId: "E1", department: "IT", designation: "Professor", mobileNo: "9000000001", qualification: "PhD", email: "faculty@x.test", role: "WRONG" };
const login = { uid: "u1", name: "Old Login Name", profilePhotoUrl: "login.jpg", employeeId: "E0", department: "CSE", designation: "Lecturer", mobileNo: "9000000002", email: "login@x.test", role: "PANEL_MEMBER", isActive: true, seatRoles: ["HOD"], departments: ["CSE", "IT"] };

describe("switch", () => {
  afterEach(() => { delete process.env.FACULTY_SINGLE_SOURCE_COLLEGES; });
  it("is OFF by default and for unlisted colleges", () => {
    expect(isSingleSourceCollege("c1")).toBe(false);
    process.env.FACULTY_SINGLE_SOURCE_COLLEGES = "other";
    expect(isSingleSourceCollege("c1")).toBe(false);
    expect(isSingleSourceCollege(undefined)).toBe(false);
  });
  it("is ON only for listed colleges (comma list, spaces tolerated)", () => {
    process.env.FACULTY_SINGLE_SOURCE_COLLEGES = " a , c1 ";
    expect(isSingleSourceCollege("c1")).toBe(true);
    expect(isSingleSourceCollege("b")).toBe(false);
    expect([...singleSourceColleges()]).toEqual(["a", "c1"]);
  });
});

describe("mergeFacultyWithLogin", () => {
  it("OFF: exactly the old merge - the login wins everywhere", () => {
    expect(mergeFacultyWithLogin(lifted, login, false)).toEqual({ ...lifted, ...login });
  });

  it("ON: faculty wins ONLY for the mirrored person fields", () => {
    const m = mergeFacultyWithLogin(lifted, login, true);
    expect(m).toMatchObject({ name: "Dr Real Name", profilePhotoUrl: "faculty.jpg", employeeId: "E1", department: "IT", designation: "Professor", mobileNo: "9000000001" });
    expect([...FACULTY_OWNED_MIRRORED_KEYS].sort()).toEqual(["department", "designation", "employeeId", "mobileNo", "name", "profilePhotoUrl"]);
  });

  it("ON: identity/access fields always stay the login's (uid, role, isActive, email, seats, departments)", () => {
    const m = mergeFacultyWithLogin(lifted, login, true);
    expect(m).toMatchObject({ uid: "u1", role: "PANEL_MEMBER", isActive: true, email: "login@x.test", seatRoles: ["HOD"], departments: ["CSE", "IT"] });
  });

  it("ON: a blank on the faculty record never hides a value the login holds (no data hidden)", () => {
    const sparse = { legalName: "  ", profilePhotoUrl: "", employeeId: undefined, department: null, designation: "  ", mobileNo: "" };
    const m = mergeFacultyWithLogin(sparse, login, true);
    expect(m).toMatchObject({ name: "Old Login Name", profilePhotoUrl: "login.jpg", employeeId: "E0", department: "CSE", designation: "Lecturer", mobileNo: "9000000002" });
  });

  it("ON: faculty-only fields (qualification etc.) and a login with no faculty value are unchanged", () => {
    expect(mergeFacultyWithLogin(lifted, login, true)).toMatchObject({ qualification: "PhD" });
    expect(mergeFacultyWithLogin({}, login, true)).toEqual(login);
  });

  it("ON, drift-free data: identical output to the old merge (the VIT 265/265 case)", () => {
    const sameLogin = { ...login, name: "Dr Real Name", profilePhotoUrl: "faculty.jpg", employeeId: "E1", department: "IT", designation: "Professor", mobileNo: "9000000001" };
    expect(mergeFacultyWithLogin(lifted, sameLogin, true)).toEqual(mergeFacultyWithLogin(lifted, sameLogin, false));
  });

  it("does not mutate its inputs", () => {
    const l = structuredClone(lifted); const g = structuredClone(login);
    mergeFacultyWithLogin(l, g, true);
    expect(l).toEqual(lifted); expect(g).toEqual(login);
  });
});

describe("merge: profile content", () => {
  it("ON: the faculty record's personal details / academic profile win when non-empty; an empty one never hides the login's", () => {
    const l = { uid: "u1", fatherName: "Login Dad", academicProfile: { researchAreasInterests: "LOGIN" }, bloodGroup: "O+" };
    const f = { fatherName: "Faculty Dad", academicProfile: { researchAreasInterests: "FACULTY" }, bloodGroup: "" };
    expect(mergeFacultyWithLogin(f, l, true)).toMatchObject({ fatherName: "Faculty Dad", academicProfile: { researchAreasInterests: "FACULTY" }, bloodGroup: "O+" });
    expect(mergeFacultyWithLogin({ academicProfile: {} }, l, true).academicProfile).toEqual({ researchAreasInterests: "LOGIN" });
  });
});

describe("FACULTY_PERSONAL_KEYS stays in step with buildPersonalDetailsUpdate", () => {
  it("every personal key the shared builder can write is on the list (so a new field cannot bypass the guard)", () => {
    const all = Object.fromEntries(FACULTY_PERSONAL_KEYS.map((k) => [k, k === "ratifications" ? [{ status: "Ratified" }] : k === "differentlyAbled" || k === "permanentAddressSameAsTemporary" ? false : k === "numberOfChildren" || k === "weightKg" ? 1 : k === "languagesKnown" ? ["en"] : k === "dateOfBirth" || k === "ratificationDate" ? "2000-01-01" : "x"]));
    const written = Object.keys(buildPersonalDetailsUpdate(all as never));
    const known = new Set<string>(FACULTY_PERSONAL_KEYS);
    for (const k of written) expect(known.has(k), `${k} is written by buildPersonalDetailsUpdate but not guarded`).toBe(true);
  });
});

describe("singleSourceBlockFor", () => {
  const login = { name: "A B", employeeId: "E1", phone: "9000000001" };
  it("blocks profile content and a CHANGED identity field; lists what it blocked", () => {
    expect(singleSourceBlockFor({ academicProfile: {} }, login)?.fields).toEqual(["academicProfile"]);
    expect(singleSourceBlockFor({ fatherName: "x", gender: "M" }, login)?.fields).toEqual(["gender", "fatherName"].sort((a, b) => FACULTY_PERSONAL_KEYS.indexOf(a as never) - FACULTY_PERSONAL_KEYS.indexOf(b as never)));
    expect(singleSourceBlockFor({ name: "New" }, login)?.fields).toEqual(["Name"]);
    expect(singleSourceBlockFor({ phone: "9111111111" }, login)?.fields).toEqual(["Mobile number"]);
    expect(singleSourceBlockFor({ employeeId: "E2" }, login)?.status).toBe(409);
  });
  it("lets through an UNCHANGED re-send, and everything that is not profile content (photo, email, department, isActive, role)", () => {
    expect(singleSourceBlockFor({ name: " A B ", employeeId: "E1", phone: "9000000001" }, login)).toBeNull();
    expect(singleSourceBlockFor({ profilePhotoUrl: "x", email: "a@b.c", collegeEmail: "c@d.e", department: "IT", isActive: false, role: "HOD", newPassword: "secret1" }, login)).toBeNull();
    expect(singleSourceBlockFor({}, login)).toBeNull();
  });
});

// ─── The two routes, with a small fake Firestore ──────────────────────────
const store = vi.hoisted(() => ({
  users: [] as { id: string; data: Record<string, unknown> }[],
  faculty: [] as { id: string; data: Record<string, unknown> }[],
  failBatched: false,
}));
vi.mock("@/lib/auth/verifySession", () => ({ requireRole: async () => ({ role: "SUPER_ADMIN" }), requireSuperAdmin: async () => ({ role: "SUPER_ADMIN" }) }));
vi.mock("@/lib/firebase/admin", () => {
  const snap = (rows: { id: string; data: Record<string, unknown> }[]) => ({ docs: rows.map((r) => ({ id: r.id, data: () => r.data })), empty: rows.length === 0 });
  const coll = (name: string) => {
    const rows = () => (name === "users" ? store.users : name === "facultyMembers" ? store.faculty : []);
    return {
      get: async () => snap(rows()),
      doc: (id: string) => ({ get: async () => { const r = rows().find((x) => x.id === id); return { exists: !!r, id, data: () => r?.data }; } }),
      where: (_f: string, op: string, v: unknown) => ({
        get: async () => {
          if (op === "in" && store.failBatched) throw new Error("index missing");
          const wanted = Array.isArray(v) ? v : [v];
          return snap(rows().filter((r) => wanted.includes(r.data.userUid)));
        },
        limit: () => ({ get: async () => snap(rows().filter((r) => r.data.userUid === v).slice(0, 1)) }),
      }),
    };
  };
  return { getAdminDb: () => ({ collection: (n: string) => (n === "colleges" ? { doc: () => ({ collection: (c: string) => coll(c) }) } : coll(n)) }) };
});

import { GET as listGET } from "@/app/api/admin/users/route";
import { GET as oneGET } from "@/app/api/admin/users/[uid]/route";

const seed = () => {
  store.failBatched = false;
  store.users = [
    { id: "u1", data: { name: "Old Login Name", role: "PANEL_MEMBER", isActive: true, email: "l@x.test", profilePhotoUrl: "login.jpg", department: "CSE", seatRoles: ["HOD"] } },
    { id: "u2", data: { name: "Staff Login", role: "COLLEGE_STAFF", isActive: true } },
    { id: "u3", data: { name: "No Record", role: "PANEL_MEMBER", isActive: true, profilePhotoUrl: "p.jpg" } },
  ];
  store.faculty = [{ id: "f1", data: { userUid: "u1", legalName: "Dr Real Name", profilePhotoUrl: "faculty.jpg", department: "IT", designation: "Professor" } }];
};
const list = async () => ((await (await listGET(new Request("http://x/api/admin/users?collegeId=c1"))).json()) as { users: Record<string, unknown>[] }).users;
const one = async () => ((await (await oneGET(new Request("http://x/api/admin/users/u1?collegeId=c1"), { params: Promise.resolve({ uid: "u1" }) })).json()) as { user: Record<string, unknown> }).user;

describe("admin users routes", () => {
  afterEach(() => { delete process.env.FACULTY_SINGLE_SOURCE_COLLEGES; vi.restoreAllMocks(); });

  it("switch OFF: list and detail are byte-identical to the old merge (login wins)", async () => {
    seed();
    const row = (await list()).find((u) => u.uid === "u1")!;
    expect(row).toMatchObject({ name: "Old Login Name", profilePhotoUrl: "login.jpg", department: "CSE", designation: "Professor", recordId: "f1" });
    expect(await one()).toMatchObject({ name: "Old Login Name", profilePhotoUrl: "login.jpg", department: "CSE", recordId: "f1" });
  });

  it("switch ON: list and detail show the faculty record's values; identity/access stay the login's", async () => {
    seed(); process.env.FACULTY_SINGLE_SOURCE_COLLEGES = "c1";
    const row = (await list()).find((u) => u.uid === "u1")!;
    expect(row).toMatchObject({ name: "Dr Real Name", profilePhotoUrl: "faculty.jpg", department: "IT", designation: "Professor", recordId: "f1", uid: "u1", role: "PANEL_MEMBER", isActive: true, email: "l@x.test", seatRoles: ["HOD"] });
    expect(await one()).toMatchObject({ name: "Dr Real Name", profilePhotoUrl: "faculty.jpg", department: "IT", recordId: "f1", uid: "u1", role: "PANEL_MEMBER" });
  });

  it("switch ON: supporting staff and a faculty login with no faculty record are untouched", async () => {
    seed(); process.env.FACULTY_SINGLE_SOURCE_COLLEGES = "c1";
    const rows = await list();
    expect(rows.find((u) => u.uid === "u3")).toMatchObject({ name: "No Record", profilePhotoUrl: "p.jpg" });
    expect(rows.find((u) => u.uid === "u2")).toMatchObject({ name: "Staff Login" });
    expect(rows.find((u) => u.uid === "u3")).not.toHaveProperty("recordId");
  });

  it("switch ON for ANOTHER college: this college is unchanged", async () => {
    seed(); process.env.FACULTY_SINGLE_SOURCE_COLLEGES = "other";
    expect((await list()).find((u) => u.uid === "u1")).toMatchObject({ name: "Old Login Name" });
  });

  it("the N+1 fallback (batched query fails) applies the same rule", async () => {
    seed(); process.env.FACULTY_SINGLE_SOURCE_COLLEGES = "c1"; store.failBatched = true;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await list()).find((u) => u.uid === "u1")).toMatchObject({ name: "Dr Real Name", profilePhotoUrl: "faculty.jpg", recordId: "f1" });
  });
});
