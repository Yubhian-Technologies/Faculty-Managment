import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Findings 1, 2 and 8 on a REAL Firestore (the local emulator), through the REAL routes/services:
//   1. an empty Years Taught is "not configured" - never "teaches everything"
//   2. a Years Taught edit that would strand sections / students / assignments / slots / subject
//      assignments / timings / exam configurations is refused, and refused BEFORE any write
//   8. the year ranges come from the course - not 1..6
// Skipped unless the emulator runs:
//   firebase emulators:exec --config <cfg> --only firestore --project demo-ys "npx vitest run src/lib/college/yearScope.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const who = { role: "PRINCIPAL" as string };

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-ys" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => { throw new Error("Auth must not be used"); } };
});
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async () => ({ uid: "u1", email: "p@x.test", role: who.role, realRole: who.role, roles: [who.role], collegeId: "c1" }),
  isDepartmentOffice: () => false,
}));

const C = "c1";
const BTECH = "btech";
const MTECH = "mtech";

describe.skipIf(!EMULATOR)("Years Taught: empty is not 'all', removals respect dependents, shared years come from data (real Firestore)", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-ys" }));
  const col = (n: string) => db().collection("colleges").doc(C).collection(n);
  const COLLECTIONS = ["departments", "courses", "courseCatalog", "sections", "students", "teachingAssignments", "timetableSlots", "subjectSemesterAssignments", "courseYearTimings", "examConfigurations", "subjects", "academicYears", "departmentKeys", "auditLogs", "sectionKeys"];
  let rollSeq = 0;
  const roll = () => `R${Date.now().toString(36)}${++rollSeq}`;

  async function seed() {
    for (const n of COLLECTIONS) for (const d of (await col(n).get()).docs) await d.ref.delete();
    const t = new Date("2026-01-01T00:00:00Z");
    await col("courseCatalog").doc(BTECH).set({ name: "B.Tech", code: "BTECH", durationYears: 4, isActive: true, regulations: [], createdAt: t });
    await col("courseCatalog").doc(MTECH).set({ name: "M.Tech", code: "MTECH", durationYears: 2, isActive: true, regulations: [], createdAt: t });
    // VIT shape: Basic Science (no own sections) holds year 1 for B.Tech; its child manages IT; IT's own years are 2-4.
    await col("departments").doc("bs").set({ collegeId: C, name: "Basic Science", code: "BS", isActive: true, hasSubDepartments: true, parentRunsOwnSections: false, courseScopes: { [BTECH]: { assignedYears: [1], secondaryDepartments: ["IT"] } }, secondaryDepartments: ["IT"], createdAt: t });
    await col("departments").doc("bsm").set({ collegeId: C, name: "Basic Science - Maths", code: "BSM", isActive: true, parentDepartmentId: "bs", managedDepartments: ["IT"], createdAt: t });
    await col("departments").doc("it").set({ collegeId: C, name: "IT", code: "IT", isActive: true, courseScopes: { [BTECH]: { assignedYears: [2, 3, 4], secondaryDepartments: [] } }, createdAt: t });
    // CSE also runs an INDEPENDENT M.Tech (years 1-2) that Basic Science does not run.
    await col("departments").doc("cse").set({ collegeId: C, name: "CSE", code: "CSE", isActive: true, courseScopes: { [BTECH]: { assignedYears: [2, 3, 4], secondaryDepartments: [] }, [MTECH]: { assignedYears: [1, 2], secondaryDepartments: [] } }, createdAt: t });
    // Nothing configured at all.
    await col("departments").doc("lonely").set({ collegeId: C, name: "Lonely", code: "LON", isActive: true, createdAt: t });
    const course = (id: string, departmentId: string, catalogId: string, name: string, durationYears: number) =>
      col("courses").doc(id).set({ collegeId: C, departmentId, catalogId, name, code: name.replace(/\W/g, "").toUpperCase(), durationYears, isActive: true, createdAt: t });
    await course("c-bs", "bs", BTECH, "B.Tech", 4);
    await course("c-it", "it", BTECH, "B.Tech", 4);
    await course("c-cse", "cse", BTECH, "B.Tech", 4);
    await course("c-cse-m", "cse", MTECH, "M.Tech", 2);
    await course("c-lonely", "lonely", BTECH, "B.Tech", 4);
  }

  beforeEach(async () => { who.role = "PRINCIPAL"; vi.spyOn(console, "error").mockImplementation(() => {}); await seed(); });

  const json = async (r: Response) => (await r.json()) as Record<string, unknown>;
  const dump = async () => {
    const out: Record<string, unknown> = {};
    for (const n of COLLECTIONS.filter((x) => !["auditLogs", "departmentKeys", "sectionKeys"].includes(x))) for (const d of (await col(n).get()).docs) out[`${n}/${d.id}`] = d.data();
    return JSON.stringify(out, (k, v) => (v && typeof v === "object" && typeof v.toDate === "function" ? v.toDate().toISOString() : v));
  };

  const postSection = async (body: Record<string, unknown>) => {
    who.role = "SUPER_ADMIN";
    const { POST } = await import("@/app/api/college/sections/route");
    return POST(new Request("http://x", { method: "POST", body: JSON.stringify({ batch: "2026-2030", ...body }) }));
  };
  const postStudent = async (body: Record<string, unknown>) => {
    const { POST } = await import("@/app/api/college/students/route");
    return POST(new Request("http://x", { method: "POST", body: JSON.stringify({ name: "Asha", rollNumber: roll(), ...body }) }));
  };
  const patchDept = async (body: Record<string, unknown>) => {
    const { PATCH } = await import("@/app/api/college/departments/route");
    return PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }));
  };

  // ── Finding 1 ──────────────────────────────────────────────────────────────
  describe("1. an empty Years Taught is NOT 'unrestricted'", () => {
    it("sections POST: a department with no Years Taught refuses every year with a clear message; a configured one still works", async () => {
      for (const year of [1, 2, 3, 4]) {
        const res = await postSection({ courseId: "c-lonely", name: "A", year });
        expect(res.status, `year ${year}`).toBe(400);
        expect(((await json(res)).error as string)).toMatch(/has no Years Taught set/);
      }
      expect((await col("sections").get()).size).toBe(0);
      expect((await postSection({ courseId: "c-it", name: "A", year: 3 })).status).toBe(201);                 // control: configured
      expect((await postSection({ courseId: "c-it", name: "B", year: 5 })).status).toBe(400);                 // beyond the course
    });

    it("sections POST: VIT behaviour preserved - a branch's SHARED Year 1 is still allowed through its manager, other years still refused", async () => {
      expect((await postSection({ courseId: "c-it", departmentId: "it", name: "A", year: 1 })).status).toBe(201);
      const refused = await postSection({ courseId: "c-it", departmentId: "it", name: "C", year: 5 });
      expect(refused.status).toBe(400);
    });

    it("sections PATCH: moving a section to a year of a department that has none is refused; an unrelated edit still works", async () => {
      expect((await postSection({ courseId: "c-it", name: "A", year: 3 })).status).toBe(201);
      const id = (await col("sections").get()).docs[0].id;
      const { PATCH } = await import("@/app/api/college/sections/[id]/route");
      await col("departments").doc("it").update({ courseScopes: {} });                                      // IT's Years Taught later cleared by hand
      who.role = "SUPER_ADMIN";
      const move = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ year: 2 }) }), { params: Promise.resolve({ id }) });
      expect(move.status).toBe(400);
      expect(((await json(move)).error as string)).toMatch(/has no Years Taught set/);
      const rename = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ studentCount: 40 }) }), { params: Promise.resolve({ id }) });
      expect(rename.status).toBe(200);                                                                      // an existing section stays editable
    });

    it("students POST (unassigned): no Years Taught -> refused; configured -> created", async () => {
      const refused = await postStudent({ department: "Lonely", course: "B.Tech", year: 2 });
      expect(refused.status).toBe(400);
      expect(((await json(refused)).error as string)).toMatch(/has no Years Taught set/);
      expect((await postStudent({ department: "IT", course: "B.Tech", year: 3 })).status).toBe(201);
    });

    it("exam configuration POST: refused for a department with no Years Taught, accepted for a configured one", async () => {
      who.role = "EXAM_CELL";
      const { POST } = await import("@/app/api/college/exam-configurations/route");
      const body = (courseId: string, department: string, year: number) => JSON.stringify({
        courseId, courseName: "B.Tech", department, year, examType: "THEORY", internalMaxMarks: 30, externalMaxMarks: 70, components: [{ name: "Mid", maxMarks: 30 }],
      });
      const refused = await POST(new Request("http://x", { method: "POST", body: body("c-lonely", "Lonely", 2) }));
      expect(refused.status).toBe(400);
      expect(((await json(refused)).error as string)).toMatch(/has no Years Taught set/);
      expect((await POST(new Request("http://x", { method: "POST", body: body("c-it", "IT", 3) }))).status).toBe(201);
    });

    it("subject assignment (SubjectInstanceService): no Years Taught -> refused; configured -> assigned", async () => {
      const { SubjectInstanceService } = await import("@/lib/subjects/services/SubjectInstanceService");
      const timing = (courseId: string, year: number, semester: number) =>
        col("courseYearTimings").doc(`${courseId}_year${year}`).set({ courseId, year, departmentId: "x", semesters: [{ semester }] });
      await timing("c-lonely", 2, 3);
      await timing("c-it", 3, 5);
      await col("subjects").doc("s1").set({ collegeId: C, name: "Maths", code: "M1", courseId: "c-it", courseName: "B.Tech" });
      const svc = new SubjectInstanceService(db() as never);
      await expect(svc.assignSubjectInstance({ collegeId: C, subjectId: "s1", departmentId: "lonely", courseId: "c-lonely", semester: 3, year: 2, departmentName: "Lonely" } as never))
        .rejects.toThrow(/has no Years Taught set/);
      const ok = await svc.assignSubjectInstance({ collegeId: C, subjectId: "s1", departmentId: "it", courseId: "c-it", semester: 5, year: 3, departmentName: "IT" } as never);
      expect(ok.instance.year).toBe(3);
    });

    it("departments PATCH: an EMPTY Years Taught list is refused outright (and nothing is written)", async () => {
      const before = await dump();
      const res = await patchDept({ deptId: "it", courseScope: { catalogId: BTECH, assignedYears: [] } });
      expect(res.status).toBe(400);
      expect(((await json(res)).error as string)).toMatch(/at least one year/);
      expect(await dump()).toBe(before);
    });

    it("departments PATCH: CLEARING a course's scope can no longer switch validation off - refused when it would leave no years", async () => {
      const before = await dump();
      const res = await patchDept({ deptId: "it", courseScope: { catalogId: BTECH, clear: true } });
      expect(res.status).toBe(400);
      expect((await json(res)).code).toBe("YEARS_WOULD_BE_EMPTY");
      expect(await dump()).toBe(before);
    });

    it("departments PATCH: clearing is still allowed when the flat Years Taught covers the same years", async () => {
      await col("departments").doc("it").update({ assignedYears: [2, 3, 4] });
      const res = await patchDept({ deptId: "it", courseScope: { catalogId: BTECH, clear: true } });
      expect(res.status).toBe(200);
      expect(((await col("departments").doc("it").get()).data() as { courseScopes?: Record<string, unknown> }).courseScopes?.[BTECH]).toBeUndefined();
    });

    it("departments PATCH: non-integer / non-list years are a 400, not a 500", async () => {
      expect((await patchDept({ deptId: "it", courseScope: { catalogId: BTECH, assignedYears: [0, 2] } })).status).toBe(400);
      expect((await patchDept({ deptId: "it", courseScope: { catalogId: BTECH, assignedYears: "2,3" } })).status).toBe(400);
    });
  });

  // ── Finding 2 ──────────────────────────────────────────────────────────────
  describe("2. removing a year that still has data is refused - before any write", () => {
    const itYears = async () => ((await col("departments").doc("it").get()).data() as { courseScopes: Record<string, { assignedYears: number[] }> }).courseScopes[BTECH].assignedYears;
    const removeIt4 = () => patchDept({ deptId: "it", courseScope: { catalogId: BTECH, assignedYears: [2, 3] } });
    const t = new Date("2026-01-01T00:00:00Z");

    // one fixture per kind of dependent data; each is filed under IT / B.Tech / Year 4
    const dependents: [string, () => Promise<unknown>, RegExp][] = [
      ["a section", () => col("sections").doc("s4").set({ collegeId: C, department: "IT", courseId: "c-it", year: 4, name: "A", createdAt: t }), /1 section/],
      ["a student", () => col("students").doc("st").set({ collegeId: C, department: "IT", courseId: "c-it", course: "B.Tech", year: 4, status: "REGULAR", name: "X", createdAt: t }), /1 student/],
      ["a student known only by course NAME (older rows)", () => col("students").doc("st").set({ collegeId: C, department: "IT", course: "B.Tech", year: 4, status: "REGULAR", name: "X", createdAt: t }), /1 student/],
      ["a teaching assignment", () => col("teachingAssignments").doc("ta").set({ collegeId: C, department: "IT", departmentId: "it", courseId: "c-it", year: 4, createdAt: t }), /1 teaching assignment/],
      ["a timetable slot", () => col("timetableSlots").doc("sl").set({ collegeId: C, department: "IT", courseId: "c-it", year: 4, day: "MON", periodNumber: 1, createdAt: t }), /1 timetable slot/],
      ["a subject assignment", () => col("subjectSemesterAssignments").doc("i").set({ collegeId: C, departmentId: "it", courseId: "c-it", year: 4, semester: 7, subjectId: "s", createdAt: t }), /1 subject assignment/],
      ["a timing setup", () => col("courseYearTimings").doc("c-it_year4").set({ courseId: "c-it", year: 4, departmentId: "it", collegeStartTime: "09:00", collegeEndTime: "16:00" }), /1 timing setup/],
      ["an exam configuration", () => col("examConfigurations").doc("c-it_year4_THEORY").set({ collegeId: C, courseId: "c-it", department: "IT", year: 4, createdAt: t }), /1 exam configuration/],
    ];

    for (const [label, makeIt, message] of dependents) {
      it(`${label} blocks the removal (409), names it, and nothing changes`, async () => {
        await makeIt();
        const before = await dump();
        const res = await removeIt4();
        expect(res.status).toBe(409);
        const body = await json(res);
        expect(body.code).toBe("YEARS_HAVE_DEPENDENTS");
        expect(body.error as string).toMatch(/Year 4 of B\.Tech in IT/);
        expect(body.error as string).toMatch(message);
        expect(await dump()).toBe(before);
        expect(await itYears()).toEqual([2, 3, 4]);
      });
    }

    it("no data -> the removal goes through and is saved", async () => {
      const res = await removeIt4();
      expect(res.status).toBe(200);
      expect(await itYears()).toEqual([2, 3]);
    });

    it("GRADUATED students (and data in OTHER years/departments) do not block it", async () => {
      await col("students").doc("grad").set({ collegeId: C, department: "IT", courseId: "c-it", year: 4, status: "GRADUATED", name: "Old", createdAt: t });
      await col("students").doc("elsewhere").set({ collegeId: C, department: "CSE", courseId: "c-cse", year: 4, status: "REGULAR", name: "Other", createdAt: t });
      await col("sections").doc("y3").set({ collegeId: C, department: "IT", courseId: "c-it", year: 3, name: "A", createdAt: t });
      expect((await removeIt4()).status).toBe(200);
    });

    it("adding years is never blocked, however much data exists", async () => {
      await col("sections").doc("s2").set({ collegeId: C, department: "IT", courseId: "c-it", year: 2, name: "A", createdAt: t });
      expect((await patchDept({ deptId: "it", courseScope: { catalogId: BTECH, assignedYears: [1, 2, 3, 4] } })).status).toBe(200);
      expect(await itYears()).toEqual([1, 2, 3, 4]);
    });

    it("removing the SHARED year from Basic Science is blocked by a branch's Year-1 section that only its manager covers", async () => {
      await col("sections").doc("y1").set({ collegeId: C, department: "IT", courseId: "c-it", year: 1, name: "A", createdAt: t });
      const before = await dump();
      const res = await patchDept({ deptId: "bs", courseScope: { catalogId: BTECH, assignedYears: [2] } });
      expect(res.status).toBe(409);
      expect((await json(res)).error as string).toMatch(/Year 1 of B\.Tech in IT: 1 section/);
      expect(await dump()).toBe(before);
    });

    it("a year only one OTHER course uses never blocks this course (per-course)", async () => {
      await col("students").doc("m").set({ collegeId: C, department: "CSE", courseId: "c-cse-m", course: "M.Tech", year: 2, status: "REGULAR", name: "M", createdAt: t });
      // dropping CSE's B.Tech year 4 is fine - the only data is CSE's M.Tech year 2
      expect((await patchDept({ deptId: "cse", courseScope: { catalogId: BTECH, assignedYears: [2, 3] } })).status).toBe(200);
      // ...but dropping M.Tech year 2 is not
      expect((await patchDept({ deptId: "cse", courseScope: { catalogId: MTECH, assignedYears: [1] } })).status).toBe(409);
    });

    it("the legacy flat Years Taught is protected the same way", async () => {
      await col("departments").doc("lonely").update({ assignedYears: [1, 2] });
      await col("academicYears").doc("y1").set({ yearNumber: 1, isActive: true });
      await col("academicYears").doc("y2").set({ yearNumber: 2, isActive: true });
      await col("sections").doc("l2").set({ collegeId: C, department: "Lonely", courseId: "c-lonely", year: 2, name: "A", createdAt: t });
      const res = await patchDept({ deptId: "lonely", assignedYears: [1] });
      expect(res.status).toBe(409);
      expect(((await col("departments").doc("lonely").get()).data() as { assignedYears: number[] }).assignedYears).toEqual([1, 2]);
    });
  });

  // ── Finding 8: shared years ────────────────────────────────────────────────
  describe("8. the subject-assignment year scan follows the COURSE's own length (not 1..6)", () => {
    it("finds the year of a semester in a course longer than 6 years, and refuses a year beyond the course", async () => {
      const { SubjectInstanceService } = await import("@/lib/subjects/services/SubjectInstanceService");
      await col("courses").doc("c-long").set({ collegeId: C, departmentId: "it", catalogId: BTECH, name: "Long", durationYears: 8, isActive: true });
      await col("courseYearTimings").doc("c-long_year7").set({ courseId: "c-long", year: 7, semesters: [{ semester: 13 }] });
      await col("courseYearTimings").doc("c-short_year5").set({ courseId: "c-short", year: 5, semesters: [{ semester: 9 }] });
      await col("courses").doc("c-short").set({ collegeId: C, departmentId: "it", catalogId: BTECH, name: "Short", durationYears: 4, isActive: true });
      const svc = new SubjectInstanceService(db() as never);
      expect(await svc.resolveYearForSemester(C, "c-long", 13)).toBe(7);                         // was: never scanned past year 6
      expect(await svc.resolveYearForSemester(C, "c-long", 13, 7)).toBe(7);                      // hint beyond 6 honoured
      expect(await svc.resolveYearForSemester(C, "c-short", 9)).toBeNull();                      // a 4-year course has no year 5
      expect(await svc.resolveYearForSemester(C, "c-short", 9, 5, 4)).toBeNull();
    });
  });
});
