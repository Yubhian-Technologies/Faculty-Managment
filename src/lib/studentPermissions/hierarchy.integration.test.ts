import { beforeAll, describe, expect, it } from "vitest";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { ApprovalError } from "@/lib/approvals";
import { istDateKey } from "@/lib/attendance/istTime";
import { loadOnDutyDay } from "@/lib/studentAttendance/onDuty";
import { savePermissionConfig } from "./configStore";
import { runPermissionEscalation } from "./escalation";
import { shiftDate } from "./rules";
import * as svc from "./service";
import type { ActingUser } from "./service";
import { APPROVAL_COLLECTION } from "@/lib/approvals";
import type { PermissionConfig } from "./types";

// End-to-end check of the approval HIERARCHY against the Firestore EMULATOR: routing, per-level hours, the scheduled
// escalation sweep, "first decision closes", the attendance lock, and the stuck-stage / clash / withdraw / revoke rules.
// Skipped unless FIRESTORE_EMULATOR_HOST is set:
//   firebase emulators:exec --only firestore --project demo-ys "npx vitest run src/lib/studentPermissions/hierarchy.integration.test.ts"

const RUN = !!process.env.FIRESTORE_EMULATOR_HOST;
const C = `hier-${Date.now().toString(36)}`;
let db: Firestore;
const col = (name: string) => db.collection("colleges").doc(C).collection(name);
const user = (uid: string, roles: string[]): ActingUser => ({ uid, name: uid, collegeId: C, roles });
const stu = (uid: string) => user(uid, ["STUDENT"]);
const hod = user("hod1", ["HOD"]);
const hodEce = user("hod2", ["HOD"]);
const incharge = user("ci1", ["PANEL_MEMBER"]);
const vp = user("vp1", ["VICE_PRINCIPAL"]);
const principal = user("pri1", ["PRINCIPAL"]);

// Distinct future class days (never a Sunday), one per request so requests never clash with each other.
let cursor = shiftDate(istDateKey(), 14);
const nextDay = () => {
  do { cursor = shiftDate(cursor, 1); } while (new Date(`${cursor}T00:00:00Z`).getUTCDay() === 0);
  return cursor;
};
const pastDay = (back: number) => {
  let d = shiftDate(istDateKey(), -back);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) d = shiftDate(d, -1);
  return d;
};

const proof = [{ url: `https://firebasestorage.googleapis.com/v0/b/b/o/${encodeURIComponent(`student-permission-proofs/${C}/u/a.pdf`)}?alt=media`, name: "Invite" }];
const input = (day: string, extra: object = {}) => ({ categoryId: "external-participation.hackathons", title: "Hackathon", description: "Finals", fromDate: day, toDate: day, periods: "ALL", proof, ...extra });

const route = (chain: string[], hours: Record<string, number> = {}): PermissionConfig => ({
  enabled: true, departments: {},
  college: { routes: { STUDENT: { "*": chain } }, ...(Object.keys(hours).length ? { limits: { stageHours: hours } } : {}) },
});
const setRoute = (cfg: PermissionConfig) => savePermissionConfig(db, C, cfg, "test");

const fail = async (p: Promise<unknown>, code: string) => {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(ApprovalError); expect((e as ApprovalError).code).toBe(code); return; }
  throw new Error(`expected ${code}`);
};
const reqDoc = (id: string) => col(APPROVAL_COLLECTION).doc(id);
const get = async (id: string) => (await reqDoc(id).get()).data()!;
const makeOverdue = (id: string) => reqDoc(id).update({ escalateAt: new Date(Date.now() - 60_000).toISOString() });
const notified = async (uid: string, type: string) => (await col("notifications").where("toUid", "==", uid).get()).docs.filter((d) => d.data().type === type).length;

async function seed() {
  await db.collection("colleges").doc(C).set({ name: "Hierarchy College" });
  await col("departments").doc("cse").set({ name: "CSE", hodUid: "hod1" });
  await col("departments").doc("ece").set({ name: "ECE", hodUid: "hod2" });
  const u = (id: string, role: string, extra: object = {}) => col("users").doc(id).set({ role, isActive: true, name: id, ...extra });
  await u("hod1", "HOD", { department: "CSE", departments: ["CSE"] });
  await u("hod2", "HOD", { department: "ECE", departments: ["ECE"] });
  await u("pri1", "PRINCIPAL"); await u("vp1", "VICE_PRINCIPAL");
  await u("ci1", "PANEL_MEMBER", { department: "CSE" });
  await col("sections").doc("sec-cse").set({ department: "CSE", name: "A", year: 3, courseId: "btech", facultyInchargeUid: "ci1" });
  await col("sections").doc("sec-ece").set({ department: "ECE", name: "A", year: 3, courseId: "btech" }); // NO incharge
  const s = (id: string, dept: string, uid: string) =>
    col("students").doc(id).set({ department: dept, section: "A", year: 3, courseId: "btech", rollNumber: id.toUpperCase(), name: `Student ${id}`, status: "REGULAR", uid });
  for (const [i, dept] of [["s1", "CSE"], ["s2", "CSE"], ["s3", "CSE"], ["s4", "CSE"], ["s5", "CSE"], ["s6", "CSE"], ["s7", "CSE"], ["s8", "CSE"], ["e1", "ECE"]]) await s(i, dept, `u${i}`);
}

describe.skipIf(!RUN)("approval hierarchy (emulator)", () => {
  beforeAll(async () => {
    const app = getApps().find((a) => a.name === "perm-hier") ?? initializeApp({ projectId: "demo-fms" }, "perm-hier");
    db = getFirestore(app);
    await seed();
  }, 30000);

  it("routing: the configured route and per-level hours are stamped on the request, first level waiting", async () => {
    await setRoute(route(["CLASS_INCHARGE", "HOD", "PRINCIPAL"], { CLASS_INCHARGE: 1, HOD: 2, PRINCIPAL: 5 }));
    const r = await svc.createStudentRequest(db, stu("us1"), input(nextDay()));
    expect(r.chain).toEqual(["CLASS_INCHARGE", "HOD", "PRINCIPAL"]);
    expect(r.pendingKey).toBe("CLASS_INCHARGE|ci1");
    expect(r.stageHours).toEqual([1, 2, 5]);
    const due = Date.parse(r.escalateAt!) - Date.parse(r.createdAt);
    expect(due).toBe(3_600_000); // exactly the incharge's 1 hour
    expect((await svc.listInbox(db, incharge)).map((x) => x.id)).toContain(r.id);
    expect((await svc.listInbox(db, hod)).map((x) => x.id)).not.toContain(r.id);
    expect(await notified("ci1", "STUDENT_PERMISSION_PENDING")).toBeGreaterThan(0);
  });

  it("escalation: nothing moves before the hours pass; after, the sweep moves it one level, notifies the next level and records it", async () => {
    await setRoute(route(["CLASS_INCHARGE", "HOD", "PRINCIPAL"], { CLASS_INCHARGE: 1, HOD: 2 }));
    const r = await svc.createStudentRequest(db, stu("us2"), input(nextDay()));
    const early = await runPermissionEscalation(db);
    expect(early.failedColleges).toEqual([]);
    expect((await get(r.id)).pendingKey).toBe("CLASS_INCHARGE|ci1"); // still within its hour

    await makeOverdue(r.id);
    const before = await notified("hod1", "STUDENT_PERMISSION_PENDING");
    await runPermissionEscalation(db);
    const up = await get(r.id);
    expect(up).toMatchObject({ status: "PENDING", pendingKey: "HOD|CSE", stageIndex: 1 });
    expect(up.history.at(-1)).toMatchObject({ action: "ESCALATE", stage: "CLASS_INCHARGE", actorUid: "system" });
    expect(Date.parse(up.escalateAt) - Date.now()).toBeGreaterThan(110 * 60_000); // a fresh ~2 hours for the HOD
    expect(await notified("hod1", "STUDENT_PERMISSION_PENDING")).toBe(before + 1);
    expect((await svc.listInbox(db, hod)).map((x) => x.id)).toContain(r.id);
    expect((await svc.listInbox(db, incharge)).map((x) => x.id)).not.toContain(r.id);
    await fail(svc.decide(db, incharge, r.id, "APPROVE"), "FORBIDDEN"); // the level that missed its window can't act any more

    await runPermissionEscalation(db); // a second sweep changes nothing
    expect((await get(r.id)).history.filter((h: { action: string }) => h.action === "ESCALATE")).toHaveLength(1);

    await makeOverdue(r.id);
    await runPermissionEscalation(db);
    const top = await get(r.id);
    expect(top).toMatchObject({ pendingKey: "PRINCIPAL|*", escalateAt: null }); // the last level has nobody above it
    await runPermissionEscalation(db);
    expect((await get(r.id)).history.filter((h: { action: string }) => h.action === "ESCALATE")).toHaveLength(2);
  });

  it("first decision closes: an approval after escalating ends the request, locks attendance On Duty, and nobody above is asked", async () => {
    await setRoute(route(["HOD", "VICE_PRINCIPAL", "PRINCIPAL"], { HOD: 1 }));
    const day = nextDay();
    // an already-submitted class on that day so the lock is visible on real attendance
    await col("studentAttendance").doc(`a1_${day}_3`).set({
      collegeId: C, department: "CSE", sectionName: "A", year: 3, date: day, periodNumber: 3, subjectId: "m1", status: "SUBMITTED",
      entries: [{ studentId: "s3", rollNumber: "S3", name: "x", status: "ABSENT" }, { studentId: "s4", rollNumber: "S4", name: "x", status: "PRESENT" }], totalStudents: 2, presentCount: 1,
    });
    const r = await svc.createStudentRequest(db, stu("us3"), input(day));
    await makeOverdue(r.id);
    await runPermissionEscalation(db);
    expect((await get(r.id)).pendingKey).toBe("VICE_PRINCIPAL|*");
    await fail(svc.decide(db, hod, r.id, "APPROVE"), "FORBIDDEN");
    const done = await svc.decide(db, vp, r.id, "APPROVE", "ok");
    expect(done).toMatchObject({ status: "APPROVED", pendingKey: null, escalateAt: null, effectStatus: "APPLIED" });
    expect(done.history.filter((h) => h.action === "APPROVE")).toHaveLength(1); // the Principal was never asked
    const lock = await loadOnDutyDay(db, C, day);
    expect(Object.keys(lock!.byStudent.s3)).toEqual([`permission:${r.id}`]);
    const sess = (await col("studentAttendance").doc(`a1_${day}_3`).get()).data()!;
    expect(sess.entries[0]).toMatchObject({ studentId: "s3", status: "ON_DUTY", previousStatus: "ABSENT" }); // locked, old mark remembered
    expect(sess.entries[1].status).toBe("PRESENT");
  });

  it("first decision closes at the first level too, and a rejection closes and stops the clock", async () => {
    await setRoute(route(["HOD", "PRINCIPAL"], { HOD: 1 }));
    const a = await svc.createStudentRequest(db, stu("us4"), input(nextDay()));
    const approved = await svc.decide(db, hod, a.id, "APPROVE");
    expect(approved).toMatchObject({ status: "APPROVED", pendingKey: null, escalateAt: null });
    expect((await svc.listInbox(db, principal)).map((x) => x.id)).not.toContain(a.id);

    const b = await svc.createStudentRequest(db, stu("us5"), input(nextDay()));
    await fail(svc.decide(db, hod, b.id, "REJECT"), "REMARK_REQUIRED");
    const rejected = await svc.decide(db, hod, b.id, "REJECT", "Clashes with exams");
    expect(rejected).toMatchObject({ status: "REJECTED", escalateAt: null });
    expect(await notified("us5", "STUDENT_PERMISSION_REJECTED")).toBe(1);
    await reqDoc(b.id).update({ escalateAt: new Date(Date.now() - 60_000).toISOString() }); // even a stale deadline must not move a closed request
    await runPermissionEscalation(db);
    expect((await get(b.id)).status).toBe("REJECTED");
    const lock = await loadOnDutyDay(db, C, b.payload.coverageDates[0]);
    expect(lock?.byStudent?.s5 ?? {}).toEqual({}); // a rejected request never locks attendance
  });

  it("an approval and the sweep racing: exactly one outcome, never both", async () => {
    await setRoute(route(["HOD", "PRINCIPAL"], { HOD: 1 }));
    const r = await svc.createStudentRequest(db, stu("us6"), input(nextDay()));
    await makeOverdue(r.id);
    await Promise.allSettled([svc.decide(db, hod, r.id, "APPROVE"), runPermissionEscalation(db)]);
    const end = await get(r.id);
    // Either the HOD got in first (approved, closed) or the sweep did (then the HOD is locked out): never an approved request still pending.
    expect(["APPROVED", "PENDING"]).toContain(end.status);
    if (end.status === "APPROVED") expect(end.pendingKey).toBeNull();
    else expect(end.pendingKey).toBe("PRINCIPAL|*");
  });

  it("stuck stages: a class with no incharge skips that level, and the retired Designated Faculty level is ignored", async () => {
    await setRoute(route(["CLASS_INCHARGE"]));
    const noCi = await svc.createStudentRequest(db, stu("ue1"), input(nextDay()));
    expect(noCi.chain).toEqual(["HOD"]); // used to strand at CLASS_INCHARGE|none
    expect(noCi.pendingKey).toBe("HOD|ECE");
    expect((await svc.listInbox(db, hodEce)).map((x) => x.id)).toContain(noCi.id);

    await setRoute(route(["DELEGATED_FACULTY", "HOD"])); // as saved by an older version
    const legacy = await svc.createStudentRequest(db, stu("us7"), input(nextDay()));
    expect(legacy.chain).toEqual(["HOD"]);
    expect(legacy.pendingKey).toBe("HOD|CSE");
    // and it can no longer be chosen
    await fail(svc.writeConfig(db, principal, route(["DELEGATED_FACULTY"])), "INVALID");
  });

  it("two requests for different periods on one day both stand; overlapping periods are refused", async () => {
    await setRoute(route(["HOD"]));
    const day = nextDay();
    const p1 = await svc.createStudentRequest(db, stu("us8"), input(day, { periods: [1, 2] }));
    const p5 = await svc.createStudentRequest(db, stu("us8"), input(day, { periods: [5], title: "Second" }));
    expect(p5.id).not.toBe(p1.id);
    await fail(svc.createStudentRequest(db, stu("us8"), input(day, { periods: [2, 3], title: "Overlap" })), "INVALID");
    await fail(svc.createStudentRequest(db, stu("us8"), input(day, { periods: "ALL", title: "Whole day" })), "INVALID");
    // approved coverage keeps the same rule
    await svc.decide(db, hod, p1.id, "APPROVE");
    await fail(svc.createStudentRequest(db, stu("us8"), input(day, { periods: [1], title: "After approval" })), "INVALID");
  });

  it("withdraw on behalf: the department's HOD (with a reason) or the Principal can; another HOD or faculty cannot; the student is told", async () => {
    await setRoute(route(["CLASS_INCHARGE", "HOD"]));
    const r = await svc.createStudentRequest(db, stu("us1"), input(nextDay(), { title: "Stuck one" }));
    await fail(svc.cancelRequest(db, hodEce, r.id, "not mine"), "FORBIDDEN");
    await fail(svc.cancelRequest(db, incharge, r.id, "not mine"), "FORBIDDEN");
    await fail(svc.cancelRequest(db, hod, r.id), "REMARK_REQUIRED");
    const c = await svc.cancelRequest(db, hod, r.id, "Student left the college");
    expect(c).toMatchObject({ status: "CANCELLED", escalateAt: null });
    expect((await col("notifications").where("toUid", "==", "us1").get()).docs.some((d) => /withdrawn by hod1.*left the college/.test(d.data().message))).toBe(true);
    // the Principal may too
    const r2 = await svc.createStudentRequest(db, stu("us2"), input(nextDay()));
    expect((await svc.cancelRequest(db, principal, r2.id, "Duplicate")).status).toBe("CANCELLED");
  });

  it("revoke: allowed before the first day, refused once the permission has started", async () => {
    await setRoute(route(["HOD"]));
    const future = await svc.createStudentRequest(db, stu("us3"), input(nextDay(), { title: "Future" }));
    await svc.decide(db, hod, future.id, "APPROVE");
    expect((await svc.revokeRequest(db, hod, future.id, "Event cancelled")).status).toBe("REVOKED");

    const started = await svc.createStudentRequest(db, stu("us4"), input(pastDay(2), { title: "Started" }));
    await svc.decide(db, hod, started.id, "APPROVE");
    await fail(svc.revokeRequest(db, hod, started.id, "too late"), "INVALID");
    expect((await get(started.id)).status).toBe("APPROVED");
  });

  it("failed attendance updates are retried by the sweep", async () => {
    await setRoute(route(["HOD"]));
    const r = await svc.createStudentRequest(db, stu("us5"), input(nextDay(), { title: "Retry" }));
    await svc.decide(db, hod, r.id, "APPROVE");
    await reqDoc(r.id).update({ effectStatus: "FAILED", effectError: "simulated" });
    const report = await runPermissionEscalation(db);
    expect(report.effectsRetried).toBeGreaterThanOrEqual(1);
    expect((await get(r.id)).effectStatus).toBe("APPLIED");
  });

  it("a request with no hours set never escalates (existing routes behave exactly as before)", async () => {
    await setRoute(route(["HOD", "PRINCIPAL"]));
    const r = await svc.createStudentRequest(db, stu("us6"), input(nextDay()));
    expect(r.escalateAt ?? null).toBeNull();
    await runPermissionEscalation(db);
    expect((await get(r.id)).pendingKey).toBe("HOD|CSE");
  });

  it("department hours override the college's, per level", async () => {
    const cfg = route(["HOD", "PRINCIPAL"], { HOD: 24 });
    cfg.departments = { CSE: { hodCanConfigure: false, override: { limits: { stageHours: { HOD: 3 } } } } };
    await setRoute(cfg);
    const cse = await svc.createStudentRequest(db, stu("us7"), input(nextDay()));
    expect(cse.stageHours?.[0]).toBe(3);
    const ece = await svc.createStudentRequest(db, stu("ue1"), input(nextDay()));
    expect(ece.stageHours?.[0]).toBe(24);
  });
});
