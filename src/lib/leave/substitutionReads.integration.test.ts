import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { getActiveSubstitutionsForDates, invalidateSubstitutionCache } from "./periodCoverage";
import { getFacultyPeriodsForDate } from "@/lib/timetable/currentPeriod";

// Counts documents READ (what Firestore bills) by the substitution lookup that sits
// behind every Mark Attendance poll, the nightly sweep and every timetable view.
// Skipped unless FIRESTORE_EMULATOR_HOST is set.
const RUN = !!process.env.FIRESTORE_EMULATOR_HOST;
const C = `reads-${Date.now().toString(36)}`;
const LEAVES = Number(process.env.READS_LEAVES ?? 3000);
const TODAY = "2026-11-10"; // Tuesday
let db: Firestore;

let reads = 0;
function instrument() {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const fs = createRequire(import.meta.url)("@google-cloud/firestore") as any;
  const wrap = (proto: any, name: string, count: (r: any) => number) => {
    const orig = proto[name];
    proto[name] = async function (...a: unknown[]) { const r = await orig.apply(this, a); reads += count(r); return r; };
  };
  wrap(fs.Query.prototype, "get", (r) => r.size);
  wrap(fs.DocumentReference.prototype, "get", () => 1);
  wrap(fs.Firestore.prototype, "getAll", (r) => (Array.isArray(r) ? r.length : 0));
}

describe.skipIf(!RUN)("substitution lookup reads", () => {
  beforeAll(async () => {
    if (!getApps().length) initializeApp({ projectId: "demo-reads" });
    db = getFirestore();
    const col = (n: string) => db.collection("colleges").doc(C).collection(n);
    await db.collection("colleges").doc(C).set({ name: "T" });
    await col("settings").doc("timetableRules").set({ workingDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT"] });
    await col("courseYearTimings").doc("cy1").set({ courseId: "co1", year: 1, periods: [{ number: 1, startTime: "09:00", endTime: "10:00" }, { number: 2, startTime: "10:00", endTime: "11:00" }] });
    for (let p = 1; p <= 2; p++) {
      await col("timetableSlots").doc(`s${p}`).set({ facultyId: "F1", day: "TUE", periodNumber: p, sectionId: "sec1", subjectId: "sub1", subjectName: "Maths", assignmentId: "a1", courseId: "co1", year: 1, department: "CSE" });
    }
    // Approved leaves spread over a year; one covers TODAY with a substitution.
    let batch = db.batch(); let n = 0;
    const flush = async () => { await batch.commit(); batch = db.batch(); n = 0; };
    for (let i = 0; i < LEAVES; i++) {
      const start = new Date(Date.UTC(2026, 0, 1 + (i % 300)));
      const ref = col("leaveRequests").doc(`l${i}`);
      batch.set(ref, { uid: `u${i}`, employeeName: `E${i}`, status: "APPROVED", fromDate: Timestamp.fromDate(start), toDate: Timestamp.fromDate(new Date(start.getTime() + 86400000)), periodSubstitutions: [] });
      if (++n === 400) await flush();
    }
    batch.set(col("leaveRequests").doc("cover"), {
      uid: "uX", employeeName: "Away", status: "APPROVED", fromDate: Timestamp.fromDate(new Date(`${TODAY}T00:00:00Z`)), toDate: Timestamp.fromDate(new Date(`${TODAY}T00:00:00Z`)),
      periodSubstitutions: [{ date: TODAY, day: "TUE", periodNumber: 1, sectionId: "sec1", subjectId: "sub1", timetableSlotId: "s1", substituteFacultyId: "F9", substituteFacultyName: "Cover", subjectName: "Maths" }],
    });
    await flush();
    instrument();
  }, 120_000);

  it("a faculty period lookup reads far fewer documents than there are approved leaves", async () => {
    invalidateSubstitutionCache();
    reads = 0;
    await getFacultyPeriodsForDate(db, C, "F1", TODAY);
    appendFileSync("/tmp/reads.out", `leaves=${LEAVES} periodLookupReads=${reads}\n`);
    expect(reads).toBeLessThan(LEAVES / 10);
  });

  it("still finds the substitution, and the substitute sees the slot", async () => {
    invalidateSubstitutionCache();
    const subs = await getActiveSubstitutionsForDates(db, C, [TODAY]);
    expect(subs.map((s) => s.substituteFacultyId)).toEqual(["F9"]);
  });

  it("repeat lookups in a burst share one read", async () => {
    invalidateSubstitutionCache();
    reads = 0;
    await getActiveSubstitutionsForDates(db, C, [TODAY]);
    const first = reads;
    reads = 0;
    for (let i = 0; i < 50; i++) await getActiveSubstitutionsForDates(db, C, [TODAY]);
    appendFileSync("/tmp/reads.out", `firstLookup=${first} fiftyMore=${reads}\n`);
    expect(reads).toBe(0);
  });
});
