import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

// PATCH /api/college/departments/[id]/neighbour - the parent/ghost-side
// "Connect to Neighbour Department" entry point (Phase 1.6). Exercises all 4
// real-world cases plus the authorization/validation boundaries.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeFirestore,
  session: { collegeId: "c1", uid: "principal-1", role: "PRINCIPAL", email: "p@x.com" },
}));
vi.mock("@/lib/auth/verifySession", () => ({ requireCollegeMember: async (...roles: string[]) => {
  if (!roles.includes(h.session.role)) throw new Error("UNAUTHORIZED");
  return h.session;
} }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db }));

const C = "colleges/c1";

function seed() {
  h.db = new FakeFirestore({
    // Case 1: flat parents, a neighbour with one PRE-EXISTING claim.
    [`${C}/departments/it`]: { name: "INFORMATION TECHNOLOGY" },
    [`${C}/departments/me`]: { name: "MECHANICAL ENGINEERING" },
    [`${C}/departments/bsp`]: { name: "BASIC SCIENCE - PHYSICS", managedDepartments: ["MECHANICAL ENGINEERING"], secondaryDepartments: ["MECHANICAL ENGINEERING"] },

    // Case 2: ghost + true children, an unrelated already-active neighbour.
    [`${C}/departments/ai`]: { name: "ARTIFICIAL INTELLIGENCE", hasSubDepartments: true, parentRunsOwnSections: false },
    [`${C}/departments/aiml`]: { name: "CSE[AIML]", parentDepartmentId: "ai" },
    [`${C}/departments/aids`]: { name: "CSE[AIDS]", parentDepartmentId: "ai" },
    [`${C}/departments/bsmaths`]: { name: "BASIC SCIENCE - MATHS", managedDepartments: ["OTHER BRANCH"], secondaryDepartments: ["OTHER BRANCH"] },
  });
}

const patch = (id: string, neighbourDepartmentId: string | null) =>
  new Request(`http://x/api/college/departments/${id}/neighbour`, { method: "PATCH", body: JSON.stringify({ neighbourDepartmentId }) });

beforeEach(() => {
  seed();
  h.session = { collegeId: "c1", uid: "principal-1", role: "PRINCIPAL", email: "p@x.com" };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PATCH /api/college/departments/[id]/neighbour", () => {
  it("Case 1: connects a flat parent (IT) to a neighbour - writes IT's own name into both arrays alongside the existing claim", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(patch("it", "bsp"), { params: Promise.resolve({ id: "it" }) });
    expect(res.status).toBe(200);
    expect(h.db.get(`${C}/departments/bsp`)).toMatchObject({
      managedDepartments: ["MECHANICAL ENGINEERING", "INFORMATION TECHNOLOGY"],
      secondaryDepartments: ["MECHANICAL ENGINEERING", "INFORMATION TECHNOLOGY"],
    });
  });

  it("Case 2: connecting the GHOST writes its own name to managedDepartments but its CHILDREN's names to secondaryDepartments", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(patch("ai", "bsmaths"), { params: Promise.resolve({ id: "ai" }) });
    expect(res.status).toBe(200);
    expect(h.db.get(`${C}/departments/bsmaths`)).toMatchObject({
      managedDepartments: ["OTHER BRANCH", "ARTIFICIAL INTELLIGENCE"],
      secondaryDepartments: ["OTHER BRANCH", "CSE[AIML]", "CSE[AIDS]"],
    });
  });

  it("refuses to connect a true CHILD directly (400)", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(patch("aiml", "bsmaths"), { params: Promise.resolve({ id: "aiml" }) });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain("parent or ghost");
  });

  it("refuses to connect to a non-neighbour target (400) and writes nothing", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(patch("it", "me"), { params: Promise.resolve({ id: "it" }) });
    expect(res.status).toBe(400);
    expect(h.db.get(`${C}/departments/me`)).toEqual({ name: "MECHANICAL ENGINEERING" }); // untouched
  });

  it("disconnects (neighbourDepartmentId: null) by removing the department's name from its current manager, leaving other claims intact", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(patch("me", null), { params: Promise.resolve({ id: "me" }) });
    expect(res.status).toBe(200);
    expect(h.db.get(`${C}/departments/bsp`)).toMatchObject({ managedDepartments: [], secondaryDepartments: [] });
  });

  it("404s when the target department doesn't exist", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(patch("nope", "bsp"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("refuses an HOD - even the connected department's own HOD - since the write lands on a department the caller doesn't own", async () => {
    h.session = { collegeId: "c1", uid: "hod-it", role: "HOD", email: "h@x.com" };
    const { PATCH } = await import("./route");
    const res = await PATCH(patch("it", "bsp"), { params: Promise.resolve({ id: "it" }) });
    expect(res.status).toBe(401);
    expect(h.db.get(`${C}/departments/bsp`)).toMatchObject({ managedDepartments: ["MECHANICAL ENGINEERING"] }); // untouched
  });
});
