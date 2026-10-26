import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

// PATCH /api/college/departments - Phase 2: the non-blocking departmentRole
// warning. Purely informative - never rejects, never changes what gets
// written. Uses a harmless field (commonYearStart) so the PATCH takes the
// simplest code path (no rename cascade, no managedDepartments/assignedYears
// validation), isolating just the new warning behavior.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeFirestore,
  session: { collegeId: "c1", uid: "principal-1", role: "PRINCIPAL", email: "p@x.com" },
}));
vi.mock("@/lib/auth/verifySession", () => ({ requireCollegeMember: async () => h.session }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db }));

const C = "colleges/c1";

function seed() {
  h.db = new FakeFirestore({
    // A GHOST with a pre-existing contradiction: it claims its own year 2,
    // even though a GHOST (parentRunsOwnSections:false) is never supposed
    // to hold a year directly - the real misconfiguration the audit found.
    [`${C}/departments/ai`]: { name: "ARTIFICIAL INTELLIGENCE", hasSubDepartments: true, parentRunsOwnSections: false, assignedYears: [2] },
    [`${C}/departments/aiml`]: { name: "CSE[AIML]", parentDepartmentId: "ai" },
    // An ordinary, unconfigured PARENT - no contradiction.
    [`${C}/departments/it`]: { name: "INFORMATION TECHNOLOGY" },
  });
}

const patch = (deptId: string, body: Record<string, unknown>) =>
  new Request("http://x/api/college/departments", { method: "PATCH", body: JSON.stringify({ deptId, ...body }) });

beforeEach(() => {
  seed();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PATCH /api/college/departments - departmentRole warning (Phase 2)", () => {
  it("surfaces a warning for a pre-existing contradiction (GHOST_HAS_OWN_YEARS), without rejecting the edit", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(patch("ai", { commonYearStart: "2024-06-01" }));
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; warning?: string };
    expect(json.ok).toBe(true);
    expect(json.warning).toContain("GHOST_HAS_OWN_YEARS");
    // The edit itself still went through - never blocked by the warning.
    expect(h.db.get(`${C}/departments/ai`)).toMatchObject({ commonYearStart: "2024-06-01" });
  });

  it("omits the warning field entirely for a department with no contradiction", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(patch("it", { commonYearStart: "2024-06-01" }));
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; warning?: string };
    expect(json.warning).toBeUndefined();
  });
});
