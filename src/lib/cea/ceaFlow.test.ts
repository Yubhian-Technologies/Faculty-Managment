import { describe, expect, it, vi } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";
import { applyCeaEntries, ceaComponentValues, reconcileRoster } from "./marks";
import { sheetFromPattern } from "@/lib/exams/questionMarks";
import { ceaPart } from "./paper";

// CEA end to end through the REAL routes on an in-memory Firestore: Exam Cell settings -> HOD plan (needs a frozen
// syllabus) -> faculty CEA marks per unit -> the internal-marks component linked to CEA is worked out (never typed)
// -> locked once internal marks are submitted.

const fake = new FakeFirestore();
const who = { uid: "ec1", role: "EXAM_CELL", collegeId: "c1", locationId: "" };
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => asFirestore(fake) }));
vi.mock("@/lib/auth/verifySession", () => {
  const s = () => ({ uid: who.uid, email: `${who.uid}@x`, role: who.role, collegeId: who.collegeId, locationId: who.locationId, exp: 0 });
  return {
    requireCollegeMember: async (...roles: string[]) => { if (!roles.includes(who.role)) throw new Error("UNAUTHORIZED"); return s(); },
    requireRole: async (...roles: string[]) => { if (!roles.includes(who.role)) throw new Error("UNAUTHORIZED"); return s(); },
  };
});
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- loose JSON in a test
const call = async (mod: Promise<Json>, method: string, body?: unknown, params?: Record<string, string>) => {
  const res = await (await mod)[method](new Request("http://x/", { method, ...(body ? { body: JSON.stringify(body) } : {}) }), params ? { params: Promise.resolve(params) } : undefined);
  return { status: res.status as number, json: (await res.json()) as Json };
};

const C = "colleges/c1";
fake.seed(C, { name: "VWU" });
fake.seed(`${C}/courseCatalog/btech`, { name: "B.Tech", regulations: ["R23", "R26"] });
fake.seed(`${C}/subjects/s1`, { name: "Maths", code: "MA101", catalogId: "btech", regulation: "R26", type: "THEORY", isActive: true });
fake.seed(`${C}/subjects/s0`, { name: "Old Maths", code: "MA100", catalogId: "btech", regulation: "R23", type: "THEORY", isActive: true });
fake.seed(`${C}/subjectSyllabus/s1`, { status: "FROZEN", units: [1, 2, 3].map((no) => ({ no, title: `U${no}` })), cos: [], mapping: {} });
fake.seed(`${C}/facultyMembers/fm1`, { userUid: "fac1", legalName: "Teacher" });
fake.seed(`${C}/sections/sec1`, { name: "A", year: 1 });
fake.seed(`${C}/teachingAssignments/ta1`, { facultyId: "fm1", facultyName: "Teacher", subjectId: "s1", subjectCode: "MA101", subjectName: "Maths", department: "CSE", sectionId: "sec1", courseId: "crs1", courseName: "B.Tech" });
for (const [id, roll] of [["st1", "26A01"], ["st2", "26A02"]]) fake.seed(`${C}/students/${id}`, { name: id, rollNumber: roll, department: "CSE", section: "A", courseId: "crs1", year: 1, uid: `u_${id}` });
fake.seed(`${C}/facultyMembers/fm2`, { userUid: "fac2", legalName: "Other" });
fake.seed(`${C}/examConfigurations/crs1_year1_THEORY`, {
  courseId: "crs1", year: 1, examType: "THEORY", status: "ACTIVE", internalMaxMarks: 40, externalMaxMarks: 60,
  components: [{ id: "mid", name: "Mid", maxMarks: 10, order: 0, isActive: true }, { id: "cea", name: "CEA", maxMarks: 30, order: 1, isActive: true, cea: true }],
});

const settingsApi = () => import("@/app/api/college/cea/settings/route");
const subjectsApi = () => import("@/app/api/college/cea/subjects/route");
const planApi = () => import("@/app/api/college/cea/plans/[subjectId]/route");
const marksApi = () => import("@/app/api/college/cea/marks/route");
const sheetApi = () => import("@/app/api/college/cea/marks/[sheetId]/route");
const internalApi = () => import("@/app/api/college/internal-exam-marks/route");
const internalIdApi = () => import("@/app/api/college/internal-exam-marks/[id]/route");
const studentApi = () => import("@/app/api/college/student/me/cea/route");
const sectionsApi = () => import("@/app/api/college/cea/sections/route");

describe("CEA marks rules", () => {
  it("number or absent; per question from the printed CEA paper; half marks; roster changes keep marks", () => {
    const roster = [{ studentId: "a", rollNumber: "1", name: "A", marks: null }, { studentId: "b", rollNumber: "2", name: "B", marks: null }];
    const e = applyCeaEntries(roster, [{ studentId: "a", marks: 7.5 }, { studentId: "b", absent: true }, { studentId: "x", marks: 1 }], 10, null);
    expect(e.map((x) => [x.marks, !!x.absent])).toEqual([[7.5, false], [0, true]]);
    expect(() => applyCeaEntries(roster, [{ studentId: "a", marks: 11 }], 10, null)).toThrow(/0-10/);
    // The setter wrote 2 questions (6 + 4 marks) for the CEA paper; marks per question add up.
    const qs = sheetFromPattern({ parts: [ceaPart({ unitMarks: 10, paperMinutes: 20 }, 2)] }, "CHOSEN", { set: 1, questions: [
      { set: 1, partId: "CEA", no: 1, kind: "SHORT", marks: 6 }, { set: 1, partId: "CEA", no: 2, kind: "SHORT", marks: 4 }] })!;
    const keys = qs.columns.map((c) => c.key);
    expect(qs.paperMax).toBe(10);
    const byQ = applyCeaEntries(roster, [{ studentId: "a", questionMarks: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 5 : 4])) }], 10, qs);
    expect(byQ[0].marks).toBe(9);
    expect(() => applyCeaEntries(roster, [{ studentId: "a", questionMarks: { [keys[1]]: 5 } }], 10, qs)).toThrow();
    expect(reconcileRoster(e, [{ id: "b", rollNumber: "2", name: "B" }, { id: "c", rollNumber: "3", name: "C" }]).map((x) => [x.studentId, x.marks])).toEqual([["b", 0], ["c", null]]);
    // 3 planned units, 2 submitted (8 + 9 = 17 of 30) into a 30-mark component = 17.
    const v = ceaComponentValues(3, 10, [
      { status: "SUBMITTED", entries: [{ studentId: "a", rollNumber: "", name: "", marks: 8 }] },
      { status: "SUBMITTED", entries: [{ studentId: "a", rollNumber: "", name: "", marks: 9 }] },
      { status: "DRAFT", entries: [{ studentId: "a", rollNumber: "", name: "", marks: 10 }] },
    ], 30);
    expect(v.get("a")).toBe(17);
  });
});

describe("CEA end to end", () => {
  it("settings -> plan -> marks -> internal marks", async () => {
    // Exam Cell: CEA on for B.Tech R26 - only the marks per unit (= a CEA paper's max) and its time are fixed.
    expect((await call(settingsApi(), "PUT", { settings: { courseKey: "btech", courseName: "B.Tech", regulation: "R23x", unitMarks: 10, paperMinutes: 20, types: [] }, version: 0 })).status).toBe(400);
    expect((await call(settingsApi(), "PUT", { settings: { courseKey: "btech", courseName: "B.Tech", regulation: "R26", unitMarks: 10, paperMinutes: 20, types: [{ label: "Assignment" }] }, version: 0 })).status).toBe(200);
    const subs = await call(subjectsApi(), "GET");
    expect(subs.json.subjects.map((s: Json) => s.code)).toEqual(["MA101"]); // R23 subject not included

    // Exam Cell plans (the Subject Department HOD would too): unit 2 with Mid 1, units 1 & 3 in class.
    const units = [{ unit: 1, typeId: "ASSIGNMENT", when: "CLASS" }, { unit: 2, when: "MID1" }, { unit: 3, typeId: "ASSIGNMENT", when: "CLASS" }];
    const plan = await call(planApi(), "PUT", { version: 0, units }, { subjectId: "s1" });
    expect(plan.status).toBe(200);
    expect(plan.json.plan.units[1]).toMatchObject({ unit: 2, typeId: "WRITTEN", when: "MID1" });

    // Faculty: units listed; open unit 1, enter, submit (needs the date).
    Object.assign(who, { uid: "fac1", role: "PANEL_MEMBER" });
    const mine = await call(marksApi(), "GET");
    expect(mine.json.assignments[0].units.map((u: Json) => [u.unit, u.status])).toEqual([[1, null], [2, null], [3, null]]);
    let s = (await call(marksApi(), "POST", { assignmentId: "ta1", unit: 1 })).json.sheet;
    expect(s.entries.map((e: Json) => e.rollNumber)).toEqual(["26A01", "26A02"]);
    const sub1 = await call(sheetApi(), "PATCH", { rev: s.rev, entries: [{ studentId: "st1", marks: 8 }, { studentId: "st2", absent: true }], action: "SUBMIT" }, { sheetId: s.id });
    expect(sub1.json.error).toMatch(/date/);
    const ok = await call(sheetApi(), "PATCH", { rev: s.rev, entries: [{ studentId: "st1", marks: 8 }, { studentId: "st2", absent: true }], heldOn: "2026-11-05", action: "SUBMIT" }, { sheetId: s.id });
    expect(ok.json.sheet.status).toBe("SUBMITTED");

    // Internal marks: the CEA column is worked out - 8 of 30 planned marks into 30 = 8; absent = 0.
    let batch = (await call(internalApi(), "POST", { assignmentId: "ta1" })).json.batch;
    expect(batch.entries.map((e: Json) => e.componentMarks.cea)).toEqual([8, 0]);
    // A typed CEA value is ignored; the Mid column is kept.
    const patched = await call(internalIdApi(), "PATCH", { entries: [{ studentId: "st1", componentMarks: { mid: 9, cea: 30 } }] }, { id: "ta1" });
    expect(patched.status).toBe(200);
    batch = fake.read(`${C}/internalExamMarks/ta1`)!;
    expect((batch.entries as Json[])[0].componentMarks).toEqual({ mid: 9, cea: 8 });

    // Unit 3 submitted -> the draft's CEA column updates by itself (8 + 10 = 18 of 30).
    s = (await call(marksApi(), "POST", { assignmentId: "ta1", unit: 3 })).json.sheet;
    await call(sheetApi(), "PATCH", { rev: s.rev, entries: [{ studentId: "st1", marks: 10 }, { studentId: "st2", marks: 6 }], heldOn: "2026-11-09", action: "SUBMIT" }, { sheetId: s.id });
    expect((fake.read(`${C}/internalExamMarks/ta1`)!.entries as Json[]).map((e) => e.componentMarks.cea)).toEqual([18, 6]);

    // The student sees their own submitted units (unit 2 not yet).
    Object.assign(who, { uid: "u_st1", role: "STUDENT" });
    const mineS = await call(studentApi(), "GET");
    expect(mineS.json.subjects[0]).toMatchObject({ code: "MA101", total: 18, submittedUnits: 2, outOf: 30 });
    expect(mineS.json.subjects[0].units.map((u: Json) => [u.unit, u.submitted, u.marks])).toEqual([[1, true, 8], [2, false, null], [3, true, 10]]);
    Object.assign(who, { uid: "u_st2" });
    expect((await call(studentApi(), "GET")).json.subjects[0].units[0]).toMatchObject({ absent: true, marks: 0 });

    // Another faculty member can't read the sheet; the Exam Cell sees every section and can open it.
    Object.assign(who, { uid: "fac2", role: "PANEL_MEMBER" });
    expect((await call(sheetApi(), "GET", undefined, { sheetId: "ta1__U1" })).status).toBe(403);
    Object.assign(who, { uid: "ec1", role: "EXAM_CELL" });
    const secs = await call(sectionsApi(), "GET");
    expect(secs.json.sections[0].units.map((u: Json) => [u.unit, u.status])).toEqual([[1, "SUBMITTED"], [2, null], [3, "SUBMITTED"]]);
    expect((await call(sheetApi(), "GET", undefined, { sheetId: "ta1__U1" })).json.sheet.entries[0].marks).toBe(8);

    // The HOD / Exam Cell can't change which unit goes with Mid 1 once that paper is printed.
    Object.assign(who, { uid: "ec1", role: "EXAM_CELL" });
    fake.seed(`${C}/midExamPlans/p1`, { midNumber: 1, year: 1 });
    fake.seed(`${C}/midPaperChoices/ch1`, { subjectId: "s1", planId: "p1", branch: "CSE", final: { pattern: { parts: [] } } });
    const moved = await call(planApi(), "PUT", { version: 1, units: [{ unit: 1, when: "MID1" }, { unit: 2, typeId: "ASSIGNMENT", when: "CLASS" }, units[2]] }, { subjectId: "s1" });
    expect(moved.status).toBe(409);

    // Internal marks submitted -> CEA locked.
    fake.seed(`${C}/internalExamMarks/ta1`, { ...fake.read(`${C}/internalExamMarks/ta1`)!, status: "SUBMITTED" });
    Object.assign(who, { uid: "fac1", role: "PANEL_MEMBER" });
    const sheet3 = fake.read(`${C}/ceaMarks/ta1__U3`)!;
    expect((await call(sheetApi(), "PATCH", { rev: sheet3.rev, action: "REOPEN" }, { sheetId: "ta1__U3" })).status).toBe(409);
  });
});
