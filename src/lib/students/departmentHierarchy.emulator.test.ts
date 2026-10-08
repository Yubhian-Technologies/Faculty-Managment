import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// The department hierarchy (parent -> sub-department -> managed core) through the REAL list routes on a real
// Firestore (the local emulator): a college shaped like VIT (a parent that only organises sub-departments, the
// sub-departments each managing branches) AND like the women's university (a core with no sections of its own, split
// into sub-branches; a core that runs sections AND has a sub-department that does). Skipped unless the emulator is
// running:
//   firebase emulators:exec --config <cfg> --only firestore --project demo-dh "node node_modules/vitest/vitest.mjs run src/lib/students/departmentHierarchy.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const who = { uid: "pr1", role: "PRINCIPAL" as string };

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-dh" }));
  return { getAdminDb: () => getFirestore(app()) };
});
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async (...roles: string[]) => {
    if (roles.length && !roles.includes(who.role)) throw new Error("UNAUTHORIZED");
    return { uid: who.uid, email: "x@y.z", role: who.role, realRole: who.role, roles: [who.role], collegeId: "c1" };
  },
  isCollegeAdmin: () => false,
  isDepartmentOffice: () => false,
}));

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- loose JSON of a route response in a test
const C = "c1";
const CAT = "cat-btech";

describe.skipIf(!EMULATOR)("department hierarchy through the real routes", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-dh" }));
  const col = (n: string) => db().collection("colleges").doc(C).collection(n);
  const scope = (years: number[]) => ({ [CAT]: { assignedYears: years, secondaryDepartments: [] } });

  beforeAll(() => { process.env.SESSION_SECRET = "test-secret"; });

  beforeEach(async () => {
    for (const n of ["students", "users", "departments", "courses", "sections", "teachingAssignments"]) for (const d of (await col(n).get()).docs) await d.ref.delete();
    who.uid = "pr1"; who.role = "PRINCIPAL";
    vi.spyOn(console, "error").mockImplementation(() => {});

    const dept = (id: string, data: Record<string, unknown>) => col("departments").doc(id).set({ collegeId: C, code: id.toUpperCase(), isActive: true, ...data });
    // VIT shape - note the parent carries NO parentRunsOwnSections flag: it is recognised as holding nothing from
    // the fact that no section is filed under it.
    await dept("bs", { name: "Basic Science", hasSubDepartments: true, courseScopes: scope([1]) });
    await dept("bsm", { name: "BS-Maths", parentDepartmentId: "bs", managedDepartments: ["AIDS"] });
    await dept("bsp", { name: "BS-Physics", parentDepartmentId: "bs", managedDepartments: ["CSE"] });
    await dept("aids", { name: "AIDS", courseScopes: scope([2, 3, 4]) });
    await dept("cse", { name: "CSE", courseScopes: scope([2, 3, 4]) });
    // Women's-university shape
    await dept("ece", { name: "ECE", hasSubDepartments: true, courseScopes: scope([2, 3, 4]) });
    await dept("vlsi", { name: "VLSI", parentDepartmentId: "ece" });
    await dept("ai", { name: "AI", hasSubDepartments: true, parentRunsOwnSections: false, courseScopes: scope([2, 3, 4]) });
    await dept("aiml", { name: "AIML", parentDepartmentId: "ai" });
    await dept("aids2", { name: "AIDS2", parentDepartmentId: "ai" });
    await dept("bsw", { name: "BS Women Maths", managedDepartments: ["AI"], courseScopes: scope([1]) });

    const course = (id: string, departmentId: string) => col("courses").doc(id).set({ collegeId: C, name: "Bachelor of Technology", code: "BT", departmentId, catalogId: CAT, durationYears: 4 });
    await course("crs-bs", "bs"); await course("crs-aids", "aids"); await course("crs-cse", "cse");
    await course("crs-ece", "ece"); await course("crs-ai", "ai"); await course("crs-bsw", "bsw");

    const section = (id: string, department: string, courseId: string, year: number) =>
      col("sections").doc(id).set({ collegeId: C, name: id, department, courseId, courseName: "Bachelor of Technology", year });
    await section("BSM-AIDS-A", "AIDS", "crs-aids", 1); // first year, filed under the real branch
    await section("BSP-CSE-A", "CSE", "crs-cse", 1);
    await section("AIDS-A", "AIDS", "crs-aids", 2);
    await section("ECE-A", "ECE", "crs-ece", 3);
    await section("VLSI-A", "VLSI", "crs-ece", 3);
    await section("AIML-A", "AIML", "crs-ai", 2);
    await section("AIDS2-A", "AIDS2", "crs-ai", 2);
    await section("BSW-AIML-A", "AIML", "crs-ai", 1);

    const student = (id: string, data: Record<string, unknown>) => col("students").doc(id).set({ collegeId: C, name: id, rollNumber: id, section: "A", course: "Bachelor of Technology", ...data });
    await student("fy-aids", { department: "BS-Maths", secondaryDepartment: "AIDS", year: 1 });
    await student("fy-cse", { department: "BS-Physics", secondaryDepartment: "CSE", year: 1 });
    await student("aids-2", { department: "AIDS", year: 2 });
    await student("ece-3", { department: "ECE", year: 3 });
    await student("vlsi-3", { department: "VLSI", year: 3 });
    await student("aiml-2", { department: "AIML", year: 2 });
    await student("aids2-2", { department: "AIDS2", year: 2 });
    await student("fy-aiml", { department: "BS Women Maths", secondaryDepartment: "AIML", year: 1 });

    await col("users").doc("hod-bs").set({ role: "HOD", department: "Basic Science", departments: ["Basic Science"] });
    await col("users").doc("hod-bsm").set({ role: "HOD", department: "BS-Maths", departments: ["BS-Maths"] });
  });

  const students = async (qs: string) => {
    const { GET } = await import("@/app/api/college/students/route");
    const res = await GET(new Request(`http://x/api/college/students?${qs}`));
    const json = (await res.json()) as Json;
    return { status: res.status, ids: ((json.students ?? []) as { id: string }[]).map((s) => s.id).sort(), json };
  };

  describe("Principal / Office list", () => {
    it("picking the parent returns every first year filed under its sub-departments (it used to return nothing)", async () => {
      const r = await students("page=1&pageSize=50&department=Basic%20Science");
      expect(r.status).toBe(200);
      expect(r.ids).toEqual(["fy-aids", "fy-cse"]);
    });

    it("a sub-department returns its own, and a Core Department narrows a parent pick", async () => {
      expect((await students("page=1&pageSize=50&department=BS-Maths")).ids).toEqual(["fy-aids"]);
      expect((await students("page=1&pageSize=50&department=Basic%20Science&coreDepartment=CSE")).ids).toEqual(["fy-cse"]);
    });

    it("a core that runs its own sections stays exact: ECE is ECE only, VLSI is VLSI only", async () => {
      expect((await students("page=1&pageSize=50&department=ECE")).ids).toEqual(["ece-3"]);
      expect((await students("page=1&pageSize=50&department=VLSI")).ids).toEqual(["vlsi-3"]);
    });

    // Like any department pick, it also matches the first years HELD for those branches (their Core Department).
    it("a core with no sections of its own rolls up to its sub-branches", async () => {
      expect((await students("page=1&pageSize=50&department=AI")).ids).toEqual(["aids2-2", "aiml-2", "fy-aiml"]);
    });

    it("a branch still returns its own later years AND the first years held for it (department OR core), as before", async () => {
      expect((await students("page=1&pageSize=50&department=AIDS")).ids).toEqual(["aids-2", "fy-aids"]);
    });

    it("the export rolls a parent up the same way", async () => {
      const r = await students("export=1&departments=Basic%20Science");
      expect(r.ids).toEqual(["fy-aids", "fy-cse"]);
    });

    it("no department filter still lists everyone", async () => {
      expect((await students("page=1&pageSize=50")).ids).toHaveLength(8);
    });
  });

  describe("HOD list", () => {
    it("the parent's HOD sees all the first years it runs, by parent pick, and by Core Department across sub-departments", async () => {
      who.uid = "hod-bs"; who.role = "HOD";
      expect((await students("page=1&pageSize=50")).ids).toEqual(["fy-aids", "fy-cse"]);
      expect((await students("page=1&pageSize=50&department=Basic%20Science")).ids).toEqual(["fy-aids", "fy-cse"]);
      expect((await students("page=1&pageSize=50&coreDepartment=AIDS")).ids).toEqual(["fy-aids"]);
    });

    it("a sub-department's HOD sees only its own", async () => {
      who.uid = "hod-bsm"; who.role = "HOD";
      expect((await students("page=1&pageSize=50")).ids).toEqual(["fy-aids"]);
    });

    it("offers the parent's own and sub-department names as Department options, never a managed branch", async () => {
      who.uid = "hod-bs"; who.role = "HOD";
      const r = await students("hodMeta=1");
      expect([...((r.json as Json).departmentNames as string[])].sort((a, b) => a.localeCompare(b))).toEqual(["Basic Science", "BS-Maths", "BS-Physics"]);
    });
  });

  // What the college-wide Timetable view asks for after a Department pick (departmentId + year).
  describe("sections API for a department pick (Principal Timetable view)", () => {
    const pickSections = async (deptId: string, year: number) => {
      who.uid = "pr1"; who.role = "PRINCIPAL";
      const { GET } = await import("@/app/api/college/sections/route");
      const res = await GET(new Request(`http://x/api/college/sections?departmentId=${deptId}&year=${year}`));
      const json = (await res.json()) as Json;
      return ((json.sections ?? []) as { name: string }[]).map((s) => s.name).sort();
    };

    it("Basic Science year 1 reaches the first-year sections of every branch its sub-departments manage", async () => {
      expect(await pickSections("bs", 1)).toEqual(["BSM-AIDS-A", "BSP-CSE-A"]);
    });
    it("each sub-department reaches only the branches it manages", async () => {
      expect(await pickSections("bsm", 1)).toEqual(["BSM-AIDS-A"]);
      expect(await pickSections("bsp", 1)).toEqual(["BSP-CSE-A"]);
    });
    it("a core that holds no sections reaches both of its branches, and each branch reaches its own", async () => {
      expect(await pickSections("ai", 2)).toEqual(["AIDS2-A", "AIML-A"]);
      expect(await pickSections("aiml", 2)).toEqual(["AIML-A"]);
      expect(await pickSections("aids2", 2)).toEqual(["AIDS2-A"]);
    });
    it("a branch's own pick is its own sections of that year, and a parent that runs sections still includes its sub-department", async () => {
      expect(await pickSections("aids", 2)).toEqual(["AIDS-A"]);
      expect(await pickSections("ece", 3)).toEqual(["ECE-A", "VLSI-A"]);
    });
    it("the first-year sections are also reachable from the branch itself (the page now offers that year there)", async () => {
      expect(await pickSections("aids", 1)).toEqual(["BSM-AIDS-A"]);
    });
  });

  describe("attendance percentage report: sections of a department that only runs the shared first year", () => {
    const sections = async (qs: string) => {
      const { GET } = await import("@/app/api/college/attendance-percentage-report/route");
      const res = await GET(new Request(`http://x/api/college/attendance-percentage-report?listSections=true&${qs}`));
      const json = (await res.json()) as Json;
      return { status: res.status, names: ((json.sections ?? []) as { name: string }[]).map((s) => s.name).sort() };
    };

    it("Basic Science year 1 reaches the first-year sections filed under the branches it runs", async () => {
      const r = await sections("department=Basic%20Science&courseId=crs-bs&year=1");
      expect(r.status).toBe(200);
      expect(r.names).toEqual(["BSM-AIDS-A", "BSP-CSE-A"]);
    });

    it("never reaches the branch's own later years", async () => {
      expect((await sections("department=Basic%20Science&courseId=crs-bs&year=2")).names).toEqual([]);
    });

    it("a sub-department reaches only the branches it manages", async () => {
      expect((await sections("department=BS-Maths&courseId=crs-bs&year=1")).names).toEqual(["BSM-AIDS-A"]);
    });

    it("a manager that groups a sectionless core (AI) reaches the sub-branches' first years", async () => {
      expect((await sections("department=BS%20Women%20Maths&courseId=crs-bsw&year=1")).names).toEqual(["BSW-AIML-A"]);
    });

    it("a branch's own request is unchanged", async () => {
      expect((await sections("department=AIDS&courseId=crs-aids&year=2")).names).toEqual(["AIDS-A"]);
    });
  });
});
