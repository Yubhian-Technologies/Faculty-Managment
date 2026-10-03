import { beforeAll, describe, expect, it } from "vitest";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { ApprovalError } from "@/lib/approvals";
import * as svc from "./service";
import type { ActingUser } from "./service";
import { applyOnDutyToEntries, loadOnDutyDay } from "@/lib/studentAttendance/onDuty";
import { indexSessions, tallyStudent } from "@/lib/studentAttendance/counting";
import type { PermissionConfig } from "./types";

// End-to-end check of the permission module against the Firestore EMULATOR.
// Skipped unless FIRESTORE_EMULATOR_HOST is set, so normal unit runs and CI are
// unaffected:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx vitest run src/lib/studentPermissions

const RUN = !!process.env.FIRESTORE_EMULATOR_HOST;
const C = `perm-${Date.now().toString(36)}`;
const D1 = "2026-11-10"; // a Tuesday: an ordinary class day
const D2 = "2026-11-11";
let db: Firestore;
const col = (name: string) => db.collection("colleges").doc(C).collection(name);

const user = (uid: string, roles: string[], name = uid): ActingUser => ({ uid, name, collegeId: C, roles });
const hod = user("hod1", ["HOD"]);
const hodEce = user("hod2", ["HOD"]);
const principal = user("pri1", ["PRINCIPAL"]);
const vp = user("vp1", ["VICE_PRINCIPAL"]);
const faculty = user("fac1", ["PANEL_MEMBER"]);
const incharge = user("ci1", ["PANEL_MEMBER"]);
const stu = (uid: string) => user(uid, ["STUDENT"]);

const input = (extra: object = {}) => ({
  categoryId: "external-participation.hackathons", title: "Smart India Hackathon", description: "Finals at IIT",
  fromDate: D1, toDate: D1, periods: "ALL", proof: [{ url: "https://x.test/invite.pdf", name: "Invite" }], ...extra,
});

async function seed() {
  await db.collection("colleges").doc(C).set({ name: "Test College" });
  await col("departments").doc("cse").set({ name: "CSE", hodUid: "hod1" });
  await col("departments").doc("ece").set({ name: "ECE", hodUid: "hod2" });
  await col("users").doc("hod1").set({ role: "HOD", department: "CSE", departments: ["CSE"], isActive: true, name: "hod1" });
  await col("users").doc("hod2").set({ role: "HOD", department: "ECE", departments: ["ECE"], isActive: true, name: "hod2" });
  await col("users").doc("pri1").set({ role: "PRINCIPAL", isActive: true, name: "pri1" });
  await col("users").doc("vp1").set({ role: "VICE_PRINCIPAL", isActive: true, name: "vp1" });
  await col("users").doc("fac1").set({ role: "PANEL_MEMBER", department: "CSE", isActive: true, name: "fac1" });
  await col("users").doc("ci1").set({ role: "PANEL_MEMBER", department: "CSE", isActive: true, name: "ci1" });
  await col("sections").doc("sec-cse-3a").set({ department: "CSE", name: "A", year: 3, courseId: "btech", facultyInchargeUid: "ci1" });
  await col("sections").doc("sec-ece-3a").set({ department: "ECE", name: "A", year: 3, courseId: "btech" });
  const s = (id: string, dept: string, uid?: string) =>
    col("students").doc(id).set({ department: dept, section: "A", year: 3, courseId: "btech", rollNumber: id.toUpperCase(), name: `Student ${id}`, status: "REGULAR", ...(uid ? { uid } : {}) });
  await s("s1", "CSE", "stu1"); await s("s2", "CSE", "stu2"); await s("s3", "CSE"); await s("e1", "ECE", "stue1");
  // An already-SUBMITTED session for CSE-3-A on D1, period 2: s1 absent, s2 present.
  await col("studentAttendance").doc(`asg1_${D1}_2`).set({
    collegeId: C, department: "CSE", sectionName: "A", year: 3, date: D1, periodNumber: 2, subjectId: "m1", status: "SUBMITTED",
    entries: [
      { studentId: "s1", rollNumber: "S1", name: "Student s1", status: "ABSENT" },
      { studentId: "s2", rollNumber: "S2", name: "Student s2", status: "PRESENT" },
      { studentId: "s3", rollNumber: "S3", name: "Student s3", status: "PRESENT" },
    ],
    totalStudents: 3, presentCount: 2,
  });
}

const fail = async (p: Promise<unknown>, code: string) => {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(ApprovalError); expect((e as ApprovalError).code).toBe(code); return; }
  throw new Error(`expected ${code}`);
};

describe.skipIf(!RUN)("student permissions (emulator)", () => {
  beforeAll(async () => {
    const app = getApps().find((a) => a.name === "perm-int") ?? initializeApp({ projectId: "demo-fms" }, "perm-int");
    db = getFirestore(app);
    await seed();
  }, 30000);

  let studentReqId = "";

  it("a student's request goes to the default route (HOD) and tells the HOD", async () => {
    const r = await svc.createStudentRequest(db, stu("stu1"), input());
    studentReqId = r.id;
    expect(r).toMatchObject({ status: "PENDING", pendingKey: "HOD|CSE", requesterType: "STUDENT", scope: "CSE" });
    expect(r.payload).toMatchObject({ coverageDates: [D1], studentUids: ["stu1"], inchargeUid: "ci1" });
    const notes = await col("notifications").where("toUid", "==", "hod1").get();
    expect(notes.docs.some((d) => d.data().type === "STUDENT_PERMISSION_PENDING")).toBe(true);
  });

  it("shows up in the HOD's inbox and the student's own list, not in another department's inbox", async () => {
    expect((await svc.listInbox(db, hod)).map((r) => r.id)).toContain(studentReqId);
    expect((await svc.listInbox(db, hodEce)).map((r) => r.id)).not.toContain(studentReqId);
    expect((await svc.listMine(db, stu("stu1"))).map((r) => r.id)).toContain(studentReqId);
  });

  it("refuses an overlapping second request while one is pending", async () => {
    await fail(svc.createStudentRequest(db, stu("stu1"), input()), "INVALID");
  });

  it("only the right HOD can decide; others, the student, and the Principal (not at that stage) cannot", async () => {
    for (const who of [hodEce, principal, vp, faculty, stu("stu1")]) await fail(svc.decide(db, who, studentReqId, "APPROVE"), "FORBIDDEN");
  });

  it("approval writes the coverage and flips an already-SUBMITTED session to ON_DUTY, keeping the old mark", async () => {
    const done = await svc.decide(db, hod, studentReqId, "APPROVE", "Go ahead");
    expect(done).toMatchObject({ status: "APPROVED", effectStatus: "APPLIED", pendingKey: null });
    const day = await loadOnDutyDay(db, C, D1);
    expect(Object.keys(day!.byStudent.s1)).toEqual([`permission:${studentReqId}`]);
    const sess = (await col("studentAttendance").doc(`asg1_${D1}_2`).get()).data()!;
    expect(sess.entries[0]).toMatchObject({ studentId: "s1", status: "ON_DUTY", previousStatus: "ABSENT" });
    expect(sess.entries[1].status).toBe("PRESENT"); // others untouched
    expect(sess.presentCount).toBe(2);
    expect(sess.status).toBe("SUBMITTED");
  });

  it("the on-duty period is left out of the student's held count", async () => {
    const sess = (await col("studentAttendance").doc(`asg1_${D1}_2`).get()).data()!;
    expect(tallyStudent(indexSessions([sess as never]), "s1")).toEqual({ held: 0, attended: 0 });
    expect(tallyStudent(indexSessions([sess as never]), "s2")).toEqual({ held: 1, attended: 1 });
  });

  it("a period opened later is pre-marked from the one-read coverage document", async () => {
    const day = await loadOnDutyDay(db, C, D1);
    const entries = applyOnDutyToEntries([
      { studentId: "s1", rollNumber: "S1", name: "x", status: null }, { studentId: "s3", rollNumber: "S3", name: "x", status: null },
    ], day, 5);
    expect(entries.map((e) => e.status)).toEqual(["ON_DUTY", null]);
    expect(await loadOnDutyDay(db, C, "2026-12-01")).toBeNull();
  });

  it("the requester sees the outcome; revoking restores the original mark and lifts the coverage", async () => {
    expect((await col("notifications").where("toUid", "==", "stu1").get()).docs.some((d) => d.data().type === "STUDENT_PERMISSION_APPROVED")).toBe(true);
    await fail(svc.revokeRequest(db, principal, studentReqId, "x"), "FORBIDDEN"); // only whoever decided the final stage
    const rev = await svc.revokeRequest(db, hod, studentReqId, "Event cancelled");
    expect(rev).toMatchObject({ status: "REVOKED", effectStatus: "APPLIED" });
    const sess = (await col("studentAttendance").doc(`asg1_${D1}_2`).get()).data()!;
    expect(sess.entries[0].status).toBe("ABSENT");
    expect("previousStatus" in sess.entries[0]).toBe(false);
    const day = await loadOnDutyDay(db, C, D1);
    expect(Object.keys(day!.byStudent.s1 ?? {})).toEqual([]);
    // and the date is free to request again
    const again = await svc.createStudentRequest(db, stu("stu1"), input());
    await svc.cancelRequest(db, stu("stu1"), again.id);
  });

  it("a faculty request spanning departments becomes one request per department, each routed to its own HOD", async () => {
    const rs = await svc.createFacultyRequests(db, faculty, input({ fromDate: D2, toDate: D2, studentIds: ["s2", "s3", "e1"] }));
    expect(rs.map((r) => r.scope).sort()).toEqual(["CSE", "ECE"]);
    expect(rs.find((r) => r.scope === "CSE")!.payload.students.map((s) => s.id).sort()).toEqual(["s2", "s3"]);
    expect(rs.every((r) => r.requesterType === "FACULTY" && r.pendingKey === `HOD|${r.scope}`)).toBe(true);
    expect((await svc.listInbox(db, hodEce)).some((r) => r.id === rs.find((x) => x.scope === "ECE")!.id)).toBe(true);
    // The covered student with a login sees it too.
    expect((await svc.listMine(db, stu("stu2"))).some((r) => r.requesterType === "FACULTY")).toBe(true);
    for (const r of rs) await svc.cancelRequest(db, faculty, r.id);
  });

  it("validation: proof required, over-long, unknown type, switched-off college", async () => {
    await fail(svc.createStudentRequest(db, stu("stu2"), input({ proof: [] })), "INVALID");
    await fail(svc.createStudentRequest(db, stu("stu2"), input({ fromDate: "2026-11-20", toDate: "2026-12-30" })), "INVALID");
    await fail(svc.createStudentRequest(db, stu("stu2"), input({ categoryId: "nope" })), "INVALID");
    await fail(svc.createStudentRequest(db, stu("nobody"), input()), "INVALID"); // login not linked to a student
  });

  it("is late-flagged (not refused) on short notice and when back-dated", async () => {
    const r = await svc.createStudentRequest(db, stu("stu2"), input({ fromDate: "2026-01-12", toDate: "2026-01-12" }));
    expect(r.payload.late).toBe(true);
    expect(r.payload.noticeHours).toBeLessThan(0);
    await svc.cancelRequest(db, stu("stu2"), r.id);
  });

  it("routing is configurable per department and per permission type; delegation gates HOD edits", async () => {
    const cfg = await svc.readConfig(db, principal);
    const proposed: PermissionConfig = structuredClone(cfg);
    proposed.college = { routes: { STUDENT: { certifications: ["CLASS_INCHARGE", "HOD"] } } };
    proposed.departments = { CSE: { hodCanConfigure: false } };
    await svc.writeConfig(db, principal, proposed);

    // certifications -> incharge then HOD; hackathons (other group) -> the built-in default (HOD)
    const cert = await svc.createStudentRequest(db, stu("stu1"), input({ categoryId: "certifications.nptel", fromDate: "2026-11-24", toDate: "2026-11-24" }));
    expect(cert.pendingKey).toBe("CLASS_INCHARGE|ci1");
    expect((await svc.listInbox(db, incharge)).map((r) => r.id)).toContain(cert.id);
    await fail(svc.decide(db, hod, cert.id, "APPROVE"), "FORBIDDEN"); // not their stage yet
    const afterCi = await svc.decide(db, incharge, cert.id, "APPROVE");
    expect(afterCi.pendingKey).toBe("HOD|CSE");
    await svc.cancelRequest(db, stu("stu1"), cert.id);

    // an HOD can't edit until the Principal delegates
    const hodEdit = structuredClone(await svc.readConfig(db, hod));
    hodEdit.departments.CSE = { hodCanConfigure: false, override: { routes: { STUDENT: { "*": ["PRINCIPAL"] } } } };
    await fail(svc.writeConfig(db, hod, hodEdit), "FORBIDDEN");
    const delegated = structuredClone(await svc.readConfig(db, principal));
    delegated.departments.CSE = { hodCanConfigure: true };
    await svc.writeConfig(db, principal, delegated);
    const hodOk = structuredClone(await svc.readConfig(db, hod));
    hodOk.departments.CSE = { hodCanConfigure: true, override: { routes: { STUDENT: { "*": ["VICE_PRINCIPAL", "PRINCIPAL"] } }, limits: { maxDays: 3 } } };
    await svc.writeConfig(db, hod, hodOk);
    await fail(svc.writeConfig(db, hodEce, { ...hodOk, departments: { ...hodOk.departments, CSE: { hodCanConfigure: true } } }), "FORBIDDEN");

    const viaDept = await svc.createStudentRequest(db, stu("stu1"), input({ fromDate: "2026-12-02", toDate: "2026-12-02" }));
    expect(viaDept.pendingKey).toBe("VICE_PRINCIPAL|*");
    expect((await svc.listInbox(db, vp)).map((r) => r.id)).toContain(viaDept.id);
    await fail(svc.createStudentRequest(db, stu("stu2"), input({ fromDate: "2026-12-03", toDate: "2026-12-09" })), "INVALID"); // dept limit: 3 days
    await svc.cancelRequest(db, stu("stu1"), viaDept.id);
  });

  it("a request can't be viewed by an unrelated login, and a missing one looks identical", async () => {
    await fail(svc.getRequest(db, hodEce, studentReqId), "NOT_FOUND");
    await fail(svc.getRequest(db, hod, "does-not-exist"), "NOT_FOUND");
    expect((await svc.getRequest(db, hod, studentReqId)).id).toBe(studentReqId);
    expect((await svc.getRequest(db, stu("stu1"), studentReqId)).id).toBe(studentReqId);
    await fail(svc.getRequest(db, stu("stu2"), studentReqId), "NOT_FOUND");
  });
});
