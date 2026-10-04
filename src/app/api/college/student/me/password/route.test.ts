import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

const h = vi.hoisted(() => ({
  db: null as unknown as FakeFirestore,
  session: null as null | { collegeId: string; uid: string; role: string },
}));
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async (...roles: string[]) => {
    if (!h.session || (roles.length && !roles.includes(h.session.role))) throw new Error("UNAUTHORIZED");
    return h.session;
  },
}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db }));

import { GET, POST } from "./route";
import { GET as getMe } from "../route";
import { GET as getAttendance } from "../attendance/route";
import { GET as getTimetable } from "../timetable/route";

const C = "colleges/c1";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.session = { collegeId: "c1", uid: "u1", role: "STUDENT" };
  h.db = new FakeFirestore({
    [`${C}/students/s1`]: { name: "Anil", rollNumber: "R1", uid: "u1", status: "REGULAR", department: "CSE", year: 1, section: "A", mustChangePassword: true },
    [`${C}/users/u1`]: { uid: "u1", role: "STUDENT", mustChangePassword: true },
  });
});

describe("student password gate (S1)", () => {
  it("GET reports that a change is required", async () => {
    expect(await (await GET()).json()).toEqual({ mustChangePassword: true });
  });

  it("every other /me data route refuses a held student with 403 PASSWORD_CHANGE_REQUIRED", async () => {
    const handlers = [getMe, getAttendance, getTimetable] as unknown as ((r?: Request) => Promise<Response>)[];
    for (const handler of handlers) {
      const res = await handler(new Request("http://localhost/x"));
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("PASSWORD_CHANGE_REQUIRED");
    }
  });

  it("POST records the change: clears the flag on the student and the profile and stamps passwordChangedAt", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ mustChangePassword: false });
    expect(h.db.get(`${C}/students/s1`)?.passwordChangedAt).toBeInstanceOf(Date);
    expect(h.db.get(`${C}/users/u1`)).toMatchObject({ mustChangePassword: false });
    expect(await (await GET()).json()).toEqual({ mustChangePassword: false });
  });

  it("POST is idempotent for a student who already changed it (no second write, no second audit entry)", async () => {
    await POST();
    const writes = h.db.writeLog.length;
    expect((await POST()).status).toBe(200);
    expect(h.db.writeLog.length).toBe(writes);
  });

  it("a legacy student (flag absent) is NOT held - existing accounts keep working until the flag script is run", async () => {
    h.db.docs.set(`${C}/students/s1`, { name: "Old", rollNumber: "R1", uid: "u1", status: "REGULAR", department: "CSE", year: 1, section: "A" });
    expect(await (await GET()).json()).toEqual({ mustChangePassword: false });
    const res = await getMe();
    expect(res.status).not.toBe(403);
  });

  it("a login that is not linked to a student gets 404 on POST and false on GET", async () => {
    h.session = { collegeId: "c1", uid: "ghost", role: "STUDENT" };
    expect((await POST()).status).toBe(404);
    expect(await (await GET()).json()).toEqual({ mustChangePassword: false });
  });

  it("only a STUDENT session can use it; no session is 401", async () => {
    h.session = { collegeId: "c1", uid: "t1", role: "PANEL_MEMBER" };
    expect((await GET()).status).toBe(401);
    expect((await POST()).status).toBe(401);
    h.session = null;
    expect((await GET()).status).toBe(401);
  });
});
