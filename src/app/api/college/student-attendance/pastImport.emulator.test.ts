import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// College Office "Import past attendance" + its undo, through the REAL routes on a real Firestore (the local emulator).
// Skipped unless the emulator is running:
//   firebase emulators:exec --only firestore --project demo-pai "npx vitest run src/app/api/college/student-attendance/pastImport.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const who = { uid: "office1", role: "COLLEGE_OFFICE", collegeId: "c1", locationId: "loc1" };

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-pai" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => ({}) };
});
vi.mock("@/lib/auth/verifySession", () => {
  const session = () => ({ uid: who.uid, email: "x@y.z", role: who.role, realRole: who.role, roles: [who.role], collegeId: who.collegeId, locationId: who.locationId });
  return {
    requireCollegeMember: async (...roles: string[]) => {
      if (roles.length && !roles.includes(who.role)) throw new Error("UNAUTHORIZED");
      return session();
    },
    verifySession: async () => session(),
  };
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- loose JSON of a route response in a test

// The most recent date strictly before today whose weekday is `dow` (0 = Sun .. 6 = Sat), as YYYY-MM-DD.
function recent(dow: number): string {
  for (let k = 1; k <= 7; k++) {
    const d = new Date(Date.now() - k * 86400000).toISOString().slice(0, 10);
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === dow) return d;
  }
  throw new Error("unreachable");
}
const TUE = recent(2);
const WED = recent(3);

describe.skipIf(!EMULATOR)("past attendance import (real Firestore)", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-pai" }));
  const col = (name: string) => db().collection("colleges").doc("c1").collection(name);

  const importRun = async (body: Record<string, unknown>) => {
    const { POST } = await import("@/app/api/college/student-attendance/past-import/route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));
    return { status: res.status, json: (await res.json()) as Json };
  };
  const rollback = async (runId: string) => {
    const { POST } = await import("@/app/api/college/student-attendance/past-import/rollback/route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ runId }) }));
    return { status: res.status, json: (await res.json()) as Json };
  };
  const base = (extra: Record<string, unknown> = {}) => ({
    sectionId: "sec1", dates: [TUE], runId: "run1", apply: false,
    students: [{ roll: "R1", marks: ["PRESENT"] }, { roll: "R2", marks: ["ABSENT"] }, { roll: "R3", marks: ["PRESENT"] }],
    ...extra,
  });
  const sessions = async () => (await col("studentAttendance").get()).docs.map((d) => ({ id: d.id, ...d.data() }) as Json);
  const tallyOf = async (studentId: string) => {
    const snap = await col("studentAttendanceTally").doc(`${studentId}_${TUE.slice(0, 7)}`).get();
    return snap.data()?.sections?.sec1?.[TUE]?.sub1 as { h: number; a: number } | undefined;
  };

  beforeEach(async () => {
    process.env.ATTENDANCE_TALLY = "on";
    for (const d of (await db().collection("colleges").get()).docs) {
      for (const sub of await d.ref.listCollections()) for (const x of (await sub.get()).docs) await x.ref.delete();
      await d.ref.delete();
    }
    who.role = "COLLEGE_OFFICE";
    vi.spyOn(console, "error").mockImplementation(() => {});
    await db().collection("colleges").doc("c1").set({ name: "Test College", isActive: true, locationId: "loc1" });
    await col("sections").doc("sec1").set({ department: "CSE", name: "A", year: 2, courseId: "course1", courseName: "B.Tech" });
    const stu = (id: string, roll: string, extra: Record<string, unknown> = {}) =>
      col("students").doc(id).set({ department: "CSE", section: "A", year: 2, courseId: "course1", rollNumber: roll, name: `Student ${roll}`, status: "ACTIVE", ...extra });
    await stu("s1", "R1");
    await stu("s2", "R2");
    await stu("s3", "R3", { dateOfJoining: "2099-01-01" }); // joins after every date in this test
    await col("facultyMembers").doc("f1").set({ userUid: "fu1", name: "Dr Fac" });
    await col("teachingAssignments").doc("ta1").set({
      facultyId: "f1", facultyName: "Dr Fac", subjectId: "sub1", subjectName: "Maths", subjectCode: "M1",
      sectionId: "sec1", department: "CSE", isPast: false,
    });
    const slot = (id: string, day: string, periodNumber: number) =>
      col("timetableSlots").doc(id).set({
        assignmentId: "ta1", subjectId: "sub1", subjectName: "Maths", facultyId: "f1", sectionId: "sec1", courseId: "course1",
        year: 2, department: "CSE", day, periodNumber, createdAt: new Date("2020-01-01T00:00:00Z"),
      });
    await slot("t1", "TUE", 1);
    await slot("t2", "TUE", 2);
    await slot("w1", "WED", 1);
  });

  it("preview reports the periods and the subject/faculty but writes nothing", async () => {
    const r = await importRun(base());
    expect(r.status).toBe(200);
    expect(r.json.applied).toBe(false);
    expect(r.json.days[0]).toMatchObject({ date: TUE, status: "READY", periods: 2, created: 2, alreadyPosted: 0 });
    expect(r.json.days[0].detail).toEqual(["P1 Maths - Dr Fac", "P2 Maths - Dr Fac"]);
    expect(await sessions()).toHaveLength(0);
  });

  it("apply creates one submitted session per period, saves every mark (even before a joining date), and updates the tally", async () => {
    const r = await importRun(base({ apply: true }));
    expect(r.json.totals).toEqual({ created: 2, alreadyPosted: 0 });
    const all = await sessions();
    expect(all.map((s) => s.id).sort()).toEqual([`ta1_${TUE}_1`, `ta1_${TUE}_2`]);
    for (const s of all) {
      expect(s).toMatchObject({ status: "SUBMITTED", postedBy: "OFFICE", importRunId: "run1", subjectId: "sub1", facultyId: "fu1", presentCount: 2, totalStudents: 3, submittedAt: null });
      expect(s.entries.map((e: Json) => [e.rollNumber, e.status]).sort()).toEqual([["R1", "PRESENT"], ["R2", "ABSENT"], ["R3", "PRESENT"]]);
    }
    expect(await tallyOf("s1")).toEqual({ h: 2, a: 2 });
    expect(await tallyOf("s2")).toEqual({ h: 2, a: 0 });
    expect(await tallyOf("s3")).toEqual({ h: 2, a: 2 }); // R3 joins "in 2099" but the register marks are still saved
  });

  it("never overwrites a period that already has attendance, and a second run adds nothing", async () => {
    await col("studentAttendance").doc(`ta1_${TUE}_1`).set({ status: "SUBMITTED", entries: [{ studentId: "s1", rollNumber: "R1", name: "x", status: "ABSENT" }], marker: "faculty" });
    const first = await importRun(base({ apply: true }));
    expect(first.json.totals).toEqual({ created: 1, alreadyPosted: 1 });
    expect((await col("studentAttendance").doc(`ta1_${TUE}_1`).get()).data()?.marker).toBe("faculty");
    const again = await importRun(base({ apply: true }));
    expect(again.json.totals).toEqual({ created: 0, alreadyPosted: 2 });
    expect(await sessions()).toHaveLength(2);
  });

  it("skips a holiday and reports why", async () => {
    await col("holidays").add({ date: new Date(`${WED}T00:00:00+05:30`), name: "Festival" });
    const r = await importRun(base({ dates: [WED], students: [{ roll: "R1", marks: ["PRESENT"] }], apply: true }));
    expect(r.json.days[0]).toMatchObject({ date: WED, status: "SKIPPED" });
    expect(r.json.days[0].reason).toContain("Holiday");
    expect(await sessions()).toHaveLength(0);
  });

  it("lists Regd. Nos that are not in the section and ignores them", async () => {
    const r = await importRun(base({ students: [{ roll: "R1", marks: ["PRESENT"] }, { roll: "NOPE", marks: ["PRESENT"] }] }));
    expect(r.json.unmatchedRolls).toEqual(["NOPE"]);
    expect(r.json.rosterNotInFile.sort()).toEqual(["R2", "R3"]);
  });

  it("only the College Office can import or undo", async () => {
    who.role = "HOD";
    expect((await importRun(base())).status).toBe(401);
    expect((await rollback("run1")).status).toBe(401);
  });

  it("undo removes the imported sessions and takes them out of the tally, but keeps one that was edited since", async () => {
    await importRun(base({ apply: true }));
    await col("studentAttendance").doc(`ta1_${TUE}_2`).update({ updatedAt: new Date(Date.now() + 60000) }); // a later correction
    const r = await rollback("run1");
    expect(r.status).toBe(200);
    expect(r.json.removed).toBe(1);
    expect(r.json.editedSinceImport).toEqual([`ta1_${TUE}_2`]);
    expect((await sessions()).map((s) => s.id)).toEqual([`ta1_${TUE}_2`]);
    expect(await tallyOf("s1")).toEqual({ h: 1, a: 1 }); // only the kept period still counts
    const audits = (await col("auditLogs").get()).docs.map((d) => d.data().action);
    expect(audits).toEqual(expect.arrayContaining(["STUDENT_ATTENDANCE_PAST_IMPORT", "STUDENT_ATTENDANCE_PAST_IMPORT_ROLLED_BACK"]));
  });

  // Two faculty in one period of the same section - the VWU labs. Batches are ignored: one session per period for
  // the whole section, so every student has the same held count.
  describe("two faculty in one period", () => {
    const secondFaculty = async (subjectId: string, subjectName: string, labBatch?: string) => {
      await col("facultyMembers").doc("f2").set({ userUid: "fu2", name: "Dr Two" });
      await col("teachingAssignments").doc("ta2").set({
        facultyId: "f2", facultyName: "Dr Two", subjectId, subjectName, subjectCode: "X2", sectionId: "sec1", department: "CSE", isPast: false,
      });
      await col("timetableSlots").doc("t3").set({
        assignmentId: "ta2", subjectId, subjectName, facultyId: "f2", sectionId: "sec1", courseId: "course1",
        year: 2, department: "CSE", day: "TUE", periodNumber: 1, createdAt: new Date("2020-01-01T00:00:00Z"), ...(labBatch ? { labBatch } : {}),
      });
    };

    it("the SAME subject taken by both: the period is counted ONCE for everyone", async () => {
      await secondFaculty("sub1", "Maths");
      const r = await importRun(base({ apply: true }));
      expect(r.json.days[0]).toMatchObject({ periods: 2, created: 2 });
      expect(r.json.days[0].detail[0]).toContain("counted once");
      expect((await sessions()).map((s) => s.id).sort()).toEqual([`ta1_${TUE}_1`, `ta1_${TUE}_2`]);
      expect(await tallyOf("s1")).toEqual({ h: 2, a: 2 }); // 2 periods held, not 3
      expect(await tallyOf("s2")).toEqual({ h: 2, a: 0 });
    });

    it("lab batches are ignored: a batch label does not split the roster", async () => {
      await col("students").doc("s1").update({ labBatch: "B1" });
      await col("students").doc("s2").update({ labBatch: "B2" });
      await secondFaculty("sub1", "Maths", "B2");
      await col("timetableSlots").doc("t1").update({ labBatch: "B1" });
      const r = await importRun(base({ apply: true }));
      const p1 = (await sessions()).find((s) => s.id === `ta1_${TUE}_1`)!;
      expect(p1.entries).toHaveLength(3); // every marked student, not one batch
      expect(r.json.totals.created).toBe(2);
    });

    it("two DIFFERENT subjects in one period are reported and not written", async () => {
      await secondFaculty("sub2", "Chemistry");
      const r = await importRun(base({ apply: true }));
      expect(r.json.days[0].skippedPeriods.join(" ")).toContain("cannot be told apart");
      expect((await sessions()).map((s) => s.id)).toEqual([`ta1_${TUE}_2`]); // only the unaffected period
    });
  });
});
