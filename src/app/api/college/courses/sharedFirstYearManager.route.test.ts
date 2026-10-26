import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

// GET /api/college/courses: an HOD of a sub-department whose PARENT is a "no
// own sections" shared-first-year branch (e.g. AIML under ARTIFICIAL
// INTELLIGENCE, itself fed by BASIC SCIENCE - MATHS for Year 1) must also see
// the FEEDER's own Course doc - that's where the shared Year 1's curriculum
// actually lives (Course-Year Timings, subject-semester-assignments), never
// on AI's or AIML's own doc. Without this, the Academics Subjects dashboard
// for such a sub-department reads as "no subjects configured" for Year 1 even
// though it plainly is, just on a doc this route never queried.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeFirestore,
  session: { collegeId: "c1", uid: "hod-aiml", role: "HOD", email: "h@x.com" },
}));
vi.mock("@/lib/auth/verifySession", () => ({ requireCollegeMember: async () => h.session }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db }));

const C = "colleges/c1";

function seed() {
  h.db = new FakeFirestore({
    // AIML's own login record - names its department directly.
    [`${C}/users/hod-aiml`]: { department: "CSE [ARTIFICIAL INTELLIGENCE & MACHINE LEARNING]", role: "HOD" },

    // ARTIFICIAL INTELLIGENCE: a "no own sections" parent - AIML/AIDS hold every real section.
    [`${C}/departments/ai`]: { name: "ARTIFICIAL INTELLIGENCE", hasSubDepartments: true, parentRunsOwnSections: false, isActive: true },
    [`${C}/departments/aiml`]: { name: "CSE [ARTIFICIAL INTELLIGENCE & MACHINE LEARNING]", parentDepartmentId: "ai", isActive: true },
    [`${C}/departments/aids`]: { name: "CSE [ARTIFICIAL INTELLIGENCE & DATA SCIENCE]", parentDepartmentId: "ai", isActive: true },
    // BASIC SCIENCE - MATHS manages AI's shared Year 1, cross-listing straight to the sub-departments.
    [`${C}/departments/maths`]: {
      name: "BASIC SCIENCE - MATHS", isActive: true,
      managedDepartments: ["ARTIFICIAL INTELLIGENCE"],
      courseScopes: { cat1: { assignedYears: [1], secondaryDepartments: ["CSE [ARTIFICIAL INTELLIGENCE & MACHINE LEARNING]", "CSE [ARTIFICIAL INTELLIGENCE & DATA SCIENCE]"] } },
    },

    // AI's own Course doc (years 2-4 - its own HOD's, not Year 1).
    [`${C}/courses/ai-course`]: { name: "Bachelor of Technology", departmentId: "ai", catalogId: "cat1", durationYears: 4 },
    // MATHS' own Course doc - where Year 1's curriculum for AI/AIML/AIDS actually lives.
    [`${C}/courses/maths-course`]: { name: "Bachelor of Technology", departmentId: "maths", catalogId: "cat1", durationYears: 4 },
    // An unrelated course MATHS also happens to run, cross-listed to nobody for this catalog - must NOT leak in.
    [`${C}/courses/maths-unrelated`]: { name: "Diploma Bridge Course", departmentId: "maths", catalogId: "cat-unrelated", durationYears: 1 },
  });
}

const get = () => new Request("http://x/api/college/courses", { method: "GET" });

beforeEach(() => {
  seed();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/college/courses - shared-first-year manager union", () => {
  it("an HOD of AIML (sub-department of a 'no own sections' AI) also sees the feeder's (BASIC SCIENCE - MATHS) Course doc", async () => {
    const { GET } = await import("@/app/api/college/courses/route");
    const res = await GET(get());
    const json = await res.json() as { courses: { id: string; departmentId: string }[] };
    const ids = json.courses.map((c) => c.id);
    expect(ids).toContain("maths-course");
    expect(ids).toContain("ai-course"); // the parent's own doc stays visible too
  });

  it("does not leak the feeder's UNRELATED course (different catalog, not cross-listed to AI)", async () => {
    const { GET } = await import("@/app/api/college/courses/route");
    const res = await GET(get());
    const json = await res.json() as { courses: { id: string }[] };
    expect(json.courses.map((c) => c.id)).not.toContain("maths-unrelated");
  });
});
