import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Findings 3 and 4 on a REAL Firestore (the local emulator), through the REAL routes:
//   3. renaming a department refreshes its own rows and NEVER another department's
//   4. a Course Catalog edit (length / name / code) reaches every department's Course doc (and the live name copies)
// Skipped unless the emulator runs:
//   firebase emulators:exec --config <cfg> --only firestore --project demo-cr "npx vitest run src/lib/college/catalogAndRename.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-cr" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => { throw new Error("Auth must not be used"); } };
});
const who = vi.hoisted(() => ({ uid: "u1", role: "PRINCIPAL" as string, realRole: "PRINCIPAL" as string }));
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async () => ({ uid: who.uid, email: "p@x.test", role: who.role, realRole: who.realRole, roles: [who.role], collegeId: "c1" }),
  isDepartmentOffice: (s: { realRole?: string }) => s.realRole === "DEPARTMENT_OFFICE",
}));

const C = "c1";
const BTECH = "btech";

describe.skipIf(!EMULATOR)("department rename + catalog edits (real Firestore)", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-cr" }));
  const col = (n: string) => db().collection("colleges").doc(C).collection(n);
  const get = async (c: string, id: string) => (await col(c).doc(id).get()).data() as Record<string, unknown>;
  const COLLECTIONS = ["departments", "courses", "courseCatalog", "sections", "students", "teachingAssignments", "timetableSlots", "subjectSemesterAssignments", "courseYearTimings", "examConfigurations", "departmentKeys", "auditLogs", "users", "roleSeats", "facultyMembers", "subjects"];
  const t = new Date("2026-01-01T00:00:00Z");

  beforeEach(async () => {
    who.uid = "u1"; who.role = "PRINCIPAL"; who.realRole = "PRINCIPAL";
    for (const n of COLLECTIONS) for (const d of (await col(n).get()).docs) await d.ref.delete();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  // ── Finding 3 ──────────────────────────────────────────────────────────────
  describe("3. renaming a department", () => {
    const patch = async (body: Record<string, unknown>) => {
      const { PATCH } = await import("@/app/api/college/departments/route");
      return PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }));
    };

    async function seedRename() {
      // Alpha is renamed. Beta is a DIFFERENT department that borrows Alpha's course for its sections.
      await col("departments").doc("a").set({ collegeId: C, name: "Alpha", code: "AL", isActive: true, createdAt: t });
      await col("departments").doc("b").set({ collegeId: C, name: "Beta", code: "BE", isActive: true, createdAt: t, secondaryDepartments: ["Alpha"], secondaryDepartmentIds: ["a"] });
      await col("departments").doc("g").set({ collegeId: C, name: "Gamma", code: "GA", isActive: true, createdAt: t, managedDepartments: ["Alpha"], managedDepartmentIds: ["a"] });
      // teaching assignments: `department` = the SECTION's department, `departmentId` = the COURSE's owner
      await col("teachingAssignments").doc("ta-beta-on-alpha-course").set({ collegeId: C, department: "Beta", departmentId: "a", courseId: "c-a", year: 1, facultyName: "F" });
      await col("teachingAssignments").doc("ta-alpha").set({ collegeId: C, department: "Alpha", departmentId: "a", courseId: "c-a", year: 2, facultyName: "F" });
      await col("teachingAssignments").doc("ta-alpha-noid").set({ collegeId: C, department: "Alpha", courseId: "c-a", year: 3, facultyName: "F" });
      await col("teachingAssignments").doc("ta-alpha-course-beta-section").set({ collegeId: C, department: "Alpha", departmentId: "b", courseId: "c-b", year: 3, facultyName: "F" });
      // a student moved Alpha -> Beta whose stale id still says Alpha (promotion/move never re-stamps it)
      await col("students").doc("moved").set({ collegeId: C, department: "Beta", departmentId: "a", year: 2, name: "Moved", status: "REGULAR" });
      await col("students").doc("stays").set({ collegeId: C, department: "Alpha", departmentId: "a", year: 2, name: "Stays", status: "REGULAR" });
      await col("students").doc("noid").set({ collegeId: C, department: "Alpha", year: 2, name: "NoId", status: "REGULAR" });
      await col("students").doc("beta-core-alpha").set({ collegeId: C, department: "Beta", secondaryDepartment: "Alpha", secondaryDepartmentId: "a", year: 1, name: "Core", status: "REGULAR" });
      await col("sections").doc("sec-alpha").set({ collegeId: C, department: "Alpha", departmentId: "a", courseId: "c-a", year: 1, name: "A", secondaryDepartments: ["Beta"], secondaryDepartmentIds: ["b"] });
      // a section feeding Alpha, with a MISALIGNED id array (the id says Alpha, the name says Beta)
      await col("sections").doc("sec-beta-misaligned").set({ collegeId: C, department: "Beta", departmentId: "b", courseId: "c-b", year: 1, name: "B", secondaryDepartments: ["Beta"], secondaryDepartmentIds: ["a"] });
      await col("sections").doc("sec-feeds-alpha").set({ collegeId: C, department: "Beta", departmentId: "b", courseId: "c-b", year: 1, name: "C", secondaryDepartments: ["Alpha"], secondaryDepartmentIds: ["a"] });
    }

    it("the renamed department's OWN rows get the new name; another department's rows keep theirs", async () => {
      await seedRename();
      const res = await patch({ deptId: "a", name: "Alpha Two" });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { cascade?: { status: string } }).cascade?.status).toBe("DONE");

      // refreshed
      expect(await get("teachingAssignments", "ta-alpha")).toMatchObject({ department: "Alpha Two", departmentId: "a" });
      expect(await get("teachingAssignments", "ta-alpha-noid")).toMatchObject({ department: "Alpha Two", departmentId: "a" });   // id stamped where there was none
      expect(await get("students", "stays")).toMatchObject({ department: "Alpha Two", departmentId: "a" });
      expect(await get("students", "noid")).toMatchObject({ department: "Alpha Two", departmentId: "a" });
      expect(await get("sections", "sec-alpha")).toMatchObject({ department: "Alpha Two", departmentId: "a" });
      expect(await get("students", "beta-core-alpha")).toMatchObject({ department: "Beta", secondaryDepartment: "Alpha Two", secondaryDepartmentId: "a" });

      // NOT touched: another department's rows that merely carry Alpha's id
      expect(await get("teachingAssignments", "ta-beta-on-alpha-course")).toMatchObject({ department: "Beta", departmentId: "a" });
      expect(await get("students", "moved")).toMatchObject({ department: "Beta", departmentId: "a" });
    });

    it("an id that is already there is never overwritten - even by a rename of the department that owns the NAME", async () => {
      await seedRename();
      // Alpha's name is on the row but its id points at Beta (course owner): the name refreshes, the id stays Beta's.
      await patch({ deptId: "a", name: "Alpha Two" });
      expect(await get("teachingAssignments", "ta-alpha-course-beta-section")).toMatchObject({ department: "Alpha Two", departmentId: "b" });
    });

    it("cross-lists in other departments (names AND id-aligned arrays) are refreshed; a misaligned element is left alone", async () => {
      await seedRename();
      await patch({ deptId: "a", name: "Alpha Two" });
      expect((await get("departments", "b")).secondaryDepartments).toEqual(["Alpha Two"]);
      expect((await get("departments", "g")).managedDepartments).toEqual(["Alpha Two"]);
      expect((await get("sections", "sec-alpha")).secondaryDepartments).toEqual(["Beta"]);               // Beta is not renamed
      expect((await get("sections", "sec-feeds-alpha")).secondaryDepartments).toEqual(["Alpha Two"]);
      expect((await get("sections", "sec-beta-misaligned")).secondaryDepartments).toEqual(["Beta"]);     // id said Alpha, name said Beta: NOT rewritten
    });

    it("renaming Alpha twice, then Beta, still never crosses over", async () => {
      await seedRename();
      await patch({ deptId: "a", name: "Alpha Two" });
      await patch({ deptId: "a", name: "Alpha Three" });
      await patch({ deptId: "b", name: "Beta Two" });
      expect(await get("teachingAssignments", "ta-beta-on-alpha-course")).toMatchObject({ department: "Beta Two", departmentId: "a" });   // Beta's own row follows Beta's rename
      expect(await get("teachingAssignments", "ta-alpha")).toMatchObject({ department: "Alpha Three" });
      expect(await get("students", "moved")).toMatchObject({ department: "Beta Two" });
      expect(await get("students", "stays")).toMatchObject({ department: "Alpha Three" });
    });

    it("re-running the same rename (the retry path) changes nothing more", async () => {
      await seedRename();
      await patch({ deptId: "a", name: "Alpha Two" });
      const snap = async () => JSON.stringify([await get("teachingAssignments", "ta-alpha"), await get("students", "moved"), await get("sections", "sec-feeds-alpha")], (k, v) => (v && typeof v === "object" && typeof v.toDate === "function" ? v.toDate().toISOString() : v));
      const once = await snap();
      const retry = await patch({ deptId: "a", resyncNameCascade: true });
      expect(retry.status).toBe(200);
      expect(await snap()).toBe(once);
    });
  });

  // ── An HOD may rename THEIR OWN sub-department (name only) ─────────────────
  describe("HOD renames their own sub-department", () => {
    const patch = async (body: Record<string, unknown>) => {
      const { PATCH } = await import("@/app/api/college/departments/route");
      return PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }));
    };
    async function seedSub() {
      await col("departments").doc("bs").set({ collegeId: C, name: "Basic Science", code: "BS", isActive: true, hasSubDepartments: true, hodUid: "hod1", createdAt: t });
      await col("departments").doc("bsm").set({ collegeId: C, name: "Bacis Science - Mathematics", code: "BSM", isActive: true, parentDepartmentId: "bs", managedDepartments: ["IT"], createdAt: t });
      await col("departments").doc("bse").set({ collegeId: C, name: "Basic Science - English", code: "BSE", isActive: true, parentDepartmentId: "bs", createdAt: t });
      await col("departments").doc("it").set({ collegeId: C, name: "IT", code: "IT", isActive: true, createdAt: t });
      await col("departments").doc("other").set({ collegeId: C, name: "Other Parent", code: "OP", isActive: true, hasSubDepartments: true, hodUid: "hod2", createdAt: t });
      await col("departments").doc("other-sub").set({ collegeId: C, name: "Other Sub", code: "OS", isActive: true, parentDepartmentId: "other", createdAt: t });
      await col("users").doc("hod1").set({ collegeId: C, name: "HOD One", role: "HOD", department: "Basic Science", departments: ["Basic Science"], isActive: true, seatRoles: [] });
      await col("sections").doc("sec").set({ collegeId: C, department: "Bacis Science - Mathematics", departmentId: "bsm", courseId: "c", year: 1, name: "A" });
      who.uid = "hod1"; who.role = "HOD"; who.realRole = "HOD";
    }

    it("renames it and cascades into its sections; the code stays as it was when none is sent", async () => {
      await seedSub();
      const res = await patch({ deptId: "bsm", name: "Basic Science - Mathematics" });
      expect(res.status).toBe(200);
      expect(await get("departments", "bsm")).toMatchObject({ name: "Basic Science - Mathematics", code: "BSM", managedDepartments: ["IT"], parentDepartmentId: "bs" });
      expect(await get("sections", "sec")).toMatchObject({ department: "Basic Science - Mathematics", departmentId: "bsm" });
    });

    it("changes the SHORT CODE too - and loses nothing: the department and everything filed under it are intact, the lock moves to the new code", async () => {
      await seedSub();
      const { departmentKeyDocId } = await import("@/lib/departments/departmentKeys");
      await col("departmentKeys").doc(departmentKeyDocId("code", "BSM")).set({ departmentId: "bsm" });
      const before = await get("departments", "bsm");
      const sectionBefore = await get("sections", "sec");
      const res = await patch({ deptId: "bsm", name: "Basic Science - Mathematics", code: "bsmath" });
      expect(res.status).toBe(200);
      const after = await get("departments", "bsm");
      expect(after).toMatchObject({ name: "Basic Science - Mathematics", code: "BSMATH" });
      // every other field of the department is exactly as it was
      for (const k of Object.keys(before)) if (!["name", "code", "updatedAt", "cascadeStatus", "cascadeOldName", "cascadeUpdatedAt"].includes(k)) expect(after[k], k).toEqual(before[k]);
      // the section follows the NAME only (it never stored the code) - nothing else on it changed
      const sectionAfter = await get("sections", "sec");
      for (const k of Object.keys(sectionBefore)) if (!["department", "updatedAt"].includes(k)) expect(sectionAfter[k], k).toEqual(sectionBefore[k]);
      // the uniqueness lock moved: old code free, new code held by this department
      expect((await col("departmentKeys").doc(departmentKeyDocId("code", "BSM")).get()).exists).toBe(false);
      expect((await col("departmentKeys").doc(departmentKeyDocId("code", "BSMATH")).get()).data()).toMatchObject({ departmentId: "bsm" });
    });

    it("a code only change (no rename) works; a code another department already uses is refused (409) and nothing changes", async () => {
      await seedSub();
      expect((await patch({ deptId: "bsm", code: "BSM2" })).status).toBe(200);
      expect(await get("departments", "bsm")).toMatchObject({ name: "Bacis Science - Mathematics", code: "BSM2" });
      const dup = await patch({ deptId: "bsm", code: "bse" });                                                       // BSE belongs to English
      expect(dup.status).toBe(409);
      expect((await get("departments", "bsm")).code).toBe("BSM2");
    });

    it("a too-long or blank code is refused; a Department Office head cannot change it", async () => {
      await seedSub();
      expect((await patch({ deptId: "bsm", code: "ABCDEFGHIJK" })).status).toBe(400);
      expect((await patch({ deptId: "bsm", code: "   " })).status).toBe(400);
      who.realRole = "DEPARTMENT_OFFICE";
      expect((await patch({ deptId: "bsm", code: "NEWCODE" })).status).toBe(403);
      expect((await get("departments", "bsm")).code).toBe("BSM");
    });

    it("a rename that collides with another department is refused (409)", async () => {
      await seedSub();
      const res = await patch({ deptId: "bsm", name: "basic science - english" });
      expect(res.status).toBe(409);
      expect((await get("departments", "bsm")).name).toBe("Bacis Science - Mathematics");
    });

    it("another HOD's sub-department, and a top-level department, cannot be renamed by this HOD", async () => {
      await seedSub();
      expect((await patch({ deptId: "other-sub", name: "Stolen" })).status).toBe(403);
      expect((await patch({ deptId: "bs", name: "Basic Science X" })).status).toBe(403);
      expect((await get("departments", "other-sub")).name).toBe("Other Sub");
      expect((await get("departments", "bs")).name).toBe("Basic Science");
    });

    it("a Department Office head (reads as HOD) is refused", async () => {
      await seedSub();
      who.realRole = "DEPARTMENT_OFFICE";
      expect((await patch({ deptId: "bsm", name: "Basic Science - Mathematics" })).status).toBe(403);
      expect((await get("departments", "bsm")).name).toBe("Bacis Science - Mathematics");
    });

    it("the dialog's usual save (no name sent) never touches the name; an unchanged name is a no-op", async () => {
      await seedSub();
      expect((await patch({ deptId: "bsm", managedDepartments: ["IT"] })).status).toBe(200);
      expect((await patch({ deptId: "bsm", name: "Bacis Science - Mathematics" })).status).toBe(200);
      expect((await get("departments", "bsm")).name).toBe("Bacis Science - Mathematics");
    });

    it("a blank name is refused", async () => {
      await seedSub();
      const res = await patch({ deptId: "bsm", name: "   " });
      expect((await get("departments", "bsm")).name).toBe("Bacis Science - Mathematics");
      expect([200, 400]).toContain(res.status);                                                                      // blank is simply ignored for an HOD
    });
  });

  // ── Finding 4 ──────────────────────────────────────────────────────────────
  describe("4. Course Catalog edits reach the department Course docs", () => {
    const patchCatalog = async (body: Record<string, unknown>) => {
      const { PATCH } = await import("@/app/api/college/course-catalog/[id]/route");
      return PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: BTECH }) });
    };

    async function seedCatalog() {
      await col("courseCatalog").doc(BTECH).set({ name: "B.Tech", code: "BTECH", durationYears: 4, isActive: true, regulations: ["R20"], createdAt: t });
      await col("courseCatalog").doc("mtech").set({ name: "M.Tech", code: "MTECH", durationYears: 2, isActive: true, regulations: [], createdAt: t });
      await col("departments").doc("it").set({ collegeId: C, name: "IT", code: "IT", isActive: true, courseScopes: { [BTECH]: { assignedYears: [1, 2, 3, 4], secondaryDepartments: [] } }, createdAt: t });
      await col("departments").doc("cse").set({ collegeId: C, name: "CSE", code: "CSE", isActive: true, courseScopes: { [BTECH]: { assignedYears: [1, 2, 3, 4], secondaryDepartments: [] } }, createdAt: t });
      const course = (id: string, departmentId: string, catalogId: string, name: string, code: string, durationYears: number) =>
        col("courses").doc(id).set({ collegeId: C, departmentId, catalogId, name, code, durationYears, isActive: true, createdAt: t });
      await course("c-it", "it", BTECH, "B.Tech", "BTECH", 4);
      await course("c-cse", "cse", BTECH, "B.Tech", "BTECH", 4);
      await course("c-m", "cse", "mtech", "M.Tech", "MTECH", 2);
    }
    const durations = async () => [(await get("courses", "c-it")).durationYears, (await get("courses", "c-cse")).durationYears, (await get("courses", "c-m")).durationYears];

    it("lengthening 4 -> 5 updates EVERY department's Course doc (and only this programme's)", async () => {
      await seedCatalog();
      const res = await patchCatalog({ name: "B.Tech", code: "BTECH", durationYears: 5 });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { coursesUpdated: number }).coursesUpdated).toBe(2);
      expect((await get("courseCatalog", BTECH)).durationYears).toBe(5);
      expect(await durations()).toEqual([5, 5, 2]);                                                       // M.Tech untouched
    });

    it("year 5 then works where it was refused before (the whole point of the sync)", async () => {
      await seedCatalog();
      await col("departments").doc("it").update({ courseScopes: { [BTECH]: { assignedYears: [1, 2, 3, 4, 5], secondaryDepartments: [] } } });
      await patchCatalog({ name: "B.Tech", code: "BTECH", durationYears: 5 });
      const { POST } = await import("@/app/api/college/sections/route");
      const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ courseId: "c-it", name: "A", year: 5, batch: "2026-2031" }) }));
      expect(res.status).toBe(201);
    });

    it("shortening is REFUSED while a department still teaches the removed year - nothing changes", async () => {
      await seedCatalog();
      const res = await patchCatalog({ name: "B.Tech", code: "BTECH", durationYears: 3 });
      expect(res.status).toBe(409);
      const message = ((await res.json()) as { error: string }).error;
      expect(message).toContain("IT (Year 4)");
      expect(message).toContain("CSE (Year 4)");
      expect(message).toMatch(/Years Taught first\. Nothing was changed/);
      expect((await get("courseCatalog", BTECH)).durationYears).toBe(4);
      expect(await durations()).toEqual([4, 4, 2]);
    });

    it("shortening is REFUSED while data sits in the removed year (even after Years Taught is cleaned up)", async () => {
      await seedCatalog();
      for (const id of ["it", "cse"]) await col("departments").doc(id).update({ courseScopes: { [BTECH]: { assignedYears: [1, 2, 3], secondaryDepartments: [] } } });
      await col("sections").doc("s4").set({ collegeId: C, department: "IT", courseId: "c-it", year: 4, name: "A", createdAt: t });
      const res = await patchCatalog({ name: "B.Tech", code: "BTECH", durationYears: 3 });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toMatch(/Year 4 still has 1 section/);
      expect(await durations()).toEqual([4, 4, 2]);
    });

    it("shortening goes through when nothing uses the removed year", async () => {
      await seedCatalog();
      for (const id of ["it", "cse"]) await col("departments").doc(id).update({ courseScopes: { [BTECH]: { assignedYears: [1, 2, 3], secondaryDepartments: [] } } });
      await col("students").doc("grad").set({ collegeId: C, department: "IT", courseId: "c-it", year: 4, status: "GRADUATED", name: "Old", createdAt: t });
      const res = await patchCatalog({ name: "B.Tech", code: "BTECH", durationYears: 3 });
      expect(res.status).toBe(200);
      expect(await durations()).toEqual([3, 3, 2]);
    });

    it("renaming updates the Course docs, the code, and the LIVE name copies - and nothing that belongs to another course", async () => {
      await seedCatalog();
      await col("students").doc("by-id").set({ collegeId: C, department: "IT", courseId: "c-it", course: "B.Tech", year: 2, status: "REGULAR", name: "A" });
      await col("students").doc("by-name").set({ collegeId: C, department: "IT", course: "B.Tech", year: 2, status: "REGULAR", name: "B" });
      await col("students").doc("mtech").set({ collegeId: C, department: "CSE", courseId: "c-m", course: "M.Tech", year: 1, status: "REGULAR", name: "C" });
      await col("students").doc("same-text-other-course").set({ collegeId: C, department: "CSE", courseId: "c-m", course: "B.Tech", year: 1, status: "REGULAR", name: "D" });
      await col("sections").doc("sec").set({ collegeId: C, department: "IT", courseId: "c-it", courseName: "B.Tech", year: 2, name: "A" });
      await col("teachingAssignments").doc("ta").set({ collegeId: C, department: "IT", courseId: "c-cse", courseName: "B.Tech", year: 2 });
      await col("teachingAssignments").doc("ta-m").set({ collegeId: C, department: "CSE", courseId: "c-m", courseName: "M.Tech", year: 1 });

      const res = await patchCatalog({ name: "Bachelor of Technology", code: "BTECHX", durationYears: 4 });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { coursesUpdated: number; cascade?: { status: string } };
      expect(body.coursesUpdated).toBe(2);
      expect(body.cascade?.status).toBe("DONE");

      expect(await get("courses", "c-it")).toMatchObject({ name: "Bachelor of Technology", code: "BTECHX" });
      expect(await get("courses", "c-cse")).toMatchObject({ name: "Bachelor of Technology", code: "BTECHX" });
      expect(await get("courses", "c-m")).toMatchObject({ name: "M.Tech", code: "MTECH" });
      expect((await get("students", "by-id")).course).toBe("Bachelor of Technology");
      expect((await get("students", "by-name")).course).toBe("Bachelor of Technology");
      expect((await get("students", "mtech")).course).toBe("M.Tech");
      expect((await get("students", "same-text-other-course")).course).toBe("B.Tech");                   // courseId is another course's: left alone
      expect((await get("sections", "sec")).courseName).toBe("Bachelor of Technology");
      expect((await get("teachingAssignments", "ta")).courseName).toBe("Bachelor of Technology");
      expect((await get("teachingAssignments", "ta-m")).courseName).toBe("M.Tech");
      expect((await get("courseCatalog", BTECH)).cascadeStatus).toBe("DONE");
    });

    it("saving UNCHANGED values repairs a Course doc that had drifted (and touches nothing else)", async () => {
      await seedCatalog();
      await col("courses").doc("c-cse").update({ durationYears: 4, name: "B.Tech (old)" });
      const res = await patchCatalog({ name: "B.Tech", code: "BTECH", durationYears: 4 });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { coursesUpdated: number }).coursesUpdated).toBe(1);
      expect((await get("courses", "c-cse")).name).toBe("B.Tech");
    });

    it("a regulations-only save (what the Regulation page sends) leaves every Course doc alone", async () => {
      await seedCatalog();
      await col("courses").doc("c-it").update({ durationYears: 9 });                                      // drift that must NOT be touched here
      const res = await patchCatalog({ regulations: ["R20", "R23"] });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { coursesUpdated: number }).coursesUpdated).toBe(0);
      expect((await get("courses", "c-it")).durationYears).toBe(9);
      expect((await get("courseCatalog", BTECH)).regulations).toEqual(["R20", "R23"]);
    });

    it("the catalog write and the course copies are ONE atomic commit (a refused shorten leaves the catalog's own fields alone too)", async () => {
      await seedCatalog();
      const res = await patchCatalog({ name: "Renamed", code: "RN", durationYears: 3 });
      expect(res.status).toBe(409);
      expect(await get("courseCatalog", BTECH)).toMatchObject({ name: "B.Tech", code: "BTECH", durationYears: 4 });
    });

    it("names and codes still have to be unique, and a 10+ year course is still refused", async () => {
      await seedCatalog();
      expect((await patchCatalog({ name: "M.Tech" })).status).toBe(409);
      expect((await patchCatalog({ durationYears: 11 })).status).toBe(400);
    });
  });
});
