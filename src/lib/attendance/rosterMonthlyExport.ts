import { closeMissedCheckouts, toAttendanceDate } from "./closeMissedCheckouts";
import { fillMissingDays } from "./fillMissingDays";
import { resolveFaceRegisteredAt } from "./registration";
import { istMonthBounds } from "./istTime";
import { isLateCheckIn } from "./lateStatus";
import { unitLabelForHeadRole, COLLEGE_STAFF_UNIT_HEAD_ROLES, type UnitHeadRole } from "./collegeStaffUnits";
import type { AttendanceRecord, MonthlySummaryRow } from "@/types";

export interface ExportRosterMember {
  uid: string;
  name: string;
  department: string;
  role: "HOD" | "PANEL_MEMBER" | "PRINCIPAL" | "VICE_PRINCIPAL" | "COLLEGE_STAFF" | UnitHeadRole;
}

const ROLE_LABELS: Record<ExportRosterMember["role"], string> = {
  HOD: "HOD",
  PANEL_MEMBER: "Faculty",
  PRINCIPAL: "Principal",
  VICE_PRINCIPAL: "Vice Principal",
  COLLEGE_STAFF: "College Staff",
  COLLEGE_OFFICE: "College Office",
  EXAM_CELL: "Exam Cell",
  LIBRARY: "Library",
  T_AND_P: "T&P",
};

// Firestore `in` query cap.
const CHUNK_SIZE = 30;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Every PANEL_MEMBER + HOD in the given department name(s) - the same
// role-then-department query shape as /api/college/attendance/report, just
// run for an explicit list of department names instead of a session-derived
// scope, so it works for an HOD's own department, or any department a
// Principal/VP/Management names explicitly.
export async function resolveDepartmentRoster(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  departmentNames: string[]
): Promise<ExportRosterMember[]> {
  const names = departmentNames.filter(Boolean).slice(0, CHUNK_SIZE);
  if (names.length === 0) return [];

  const collegeRef = db.collection("colleges").doc(collegeId);
  const [facultySnap, hodSnap] = await Promise.all([
    collegeRef.collection("users").where("role", "==", "PANEL_MEMBER").where("department", "in", names).get(),
    collegeRef.collection("users").where("role", "==", "HOD").where("department", "in", names).get(),
  ]);

  const roster: ExportRosterMember[] = [];
  for (const d of facultySnap.docs) {
    const u = d.data() as { name?: string; department?: string };
    roster.push({ uid: d.id, name: u.name ?? "", department: u.department ?? "", role: "PANEL_MEMBER" });
  }
  for (const d of hodSnap.docs) {
    const u = d.data() as { name?: string; department?: string };
    roster.push({ uid: d.id, name: u.name ?? "", department: u.department ?? "", role: "HOD" });
  }
  return roster;
}

// A unit head's own roster for the CSV export - the head (role only, no
// department filter, singleton per college) plus every COLLEGE_STAFF member
// whose `department` matches this unit's label (same department-string link
// every other unit-head route uses, see collegeStaffUnits.ts).
export async function resolveCollegeStaffUnitRoster(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  headRole: UnitHeadRole
): Promise<ExportRosterMember[]> {
  const unitLabel = unitLabelForHeadRole(headRole);
  if (!unitLabel) return [];

  const collegeRef = db.collection("colleges").doc(collegeId);
  const [headSnap, staffSnap] = await Promise.all([
    collegeRef.collection("users").where("role", "==", headRole).get(),
    collegeRef.collection("users").where("role", "==", "COLLEGE_STAFF").where("department", "==", unitLabel).get(),
  ]);

  const roster: ExportRosterMember[] = [];
  for (const d of headSnap.docs) {
    const u = d.data() as { name?: string };
    roster.push({ uid: d.id, name: u.name ?? "", department: unitLabel, role: headRole });
  }
  for (const d of staffSnap.docs) {
    const u = d.data() as { name?: string; department?: string };
    roster.push({ uid: d.id, name: u.name ?? "", department: u.department ?? unitLabel, role: "COLLEGE_STAFF" });
  }
  return roster;
}

// Every HOD, Faculty, Principal, Vice Principal, and unit head + staff in the
// college - the college-wide export roster. Principal/Vice Principal/unit
// heads have no `department` field on their own users/{uid} doc (they run
// the whole college, see FMSUser.department's doc comment), so their CSV
// rows are labelled by role instead of a department name.
export async function resolveCollegeRoster(
  db: FirebaseFirestore.Firestore,
  collegeId: string
): Promise<ExportRosterMember[]> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const usersSnap = await collegeRef
    .collection("users")
    .where("role", "in", ["PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_STAFF", ...COLLEGE_STAFF_UNIT_HEAD_ROLES])
    .get();

  return usersSnap.docs.map((d) => {
    const u = d.data() as { name?: string; department?: string; role?: ExportRosterMember["role"] };
    const role = u.role ?? "PANEL_MEMBER";
    const department = u.department || ROLE_LABELS[role];
    return { uid: d.id, name: u.name ?? "", department, role };
  });
}

// Builds a "one row per person" monthly summary for an entire roster (a
// department, unit, or a whole college) - each row tallies how many of that
// person's days this month landed in each status, rather than listing every
// day (a 2000-person college-wide export would otherwise be tens of
// thousands of CSV rows for one month - the per-day breakdown for a single
// person is already available from their own "My Attendance" export). Runs
// the same fillMissingDays pipeline every single-person monthly view uses,
// once per roster member, then tallies instead of flattening.
export async function buildRosterMonthlySummary(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  roster: ExportRosterMember[],
  year: number,
  month: number
): Promise<MonthlySummaryRow[]> {
  if (roster.length === 0) return [];

  const collegeRef = db.collection("colleges").doc(collegeId);
  const { monthStart, monthEnd } = istMonthBounds(year, month);

  const memberByUid = new Map(roster.map((m) => [m.uid, m]));
  const recordsByUid = new Map<
    string,
    (AttendanceRecord & { id: string; ref: FirebaseFirestore.DocumentReference; resolvedDate: Date | null })[]
  >();
  for (const m of roster) recordsByUid.set(m.uid, []);

  const uids = roster.map((m) => m.uid);
  for (const group of chunk(uids, CHUNK_SIZE)) {
    const snap = await collegeRef.collection("attendanceRecords").where("facultyId", "in", group).get();
    for (const doc of snap.docs) {
      const data = doc.data() as AttendanceRecord;
      if (!memberByUid.has(data.facultyId)) continue;
      const resolvedDate = toAttendanceDate(data.date);
      if (!resolvedDate || resolvedDate < monthStart || resolvedDate >= monthEnd) continue;
      recordsByUid.get(data.facultyId)!.push({ ...data, id: doc.id, ref: doc.ref, resolvedDate });
    }
  }

  // closeMissedCheckouts persists corrections across the whole roster in one
  // batch, same as every other attendance route.
  await closeMissedCheckouts(db, Array.from(recordsByUid.values()).flat());

  const registeredAtByUid = new Map(
    await Promise.all(
      roster.map(async (m) => [m.uid, await resolveFaceRegisteredAt(db, collegeId, m.uid, m.role)] as const)
    )
  );

  const rows: MonthlySummaryRow[] = [];
  for (const member of roster) {
    const records = (recordsByUid.get(member.uid) ?? []).sort(
      (a, b) => (a.resolvedDate?.getTime() ?? 0) - (b.resolvedDate?.getTime() ?? 0)
    );
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit ref/resolvedDate from the real records
    const realRecords = records.map(({ ref: _ref, resolvedDate: _resolvedDate, ...rec }) => rec);
    const filled = fillMissingDays(realRecords, monthStart, monthEnd, registeredAtByUid.get(member.uid) ?? null, {
      collegeId,
      facultyId: member.uid,
      facultyName: member.name,
      department: member.department,
    });

    let present = 0, absent = 0, halfDay = 0, onLeave = 0, onDuty = 0, holiday = 0, lateArrivals = 0;
    for (const rec of filled) {
      switch (rec.status) {
        case "PRESENT":
          present++;
          if (isLateCheckIn(rec.checkIn)) lateArrivals++;
          break;
        case "ABSENT": absent++; break;
        case "HALF_DAY": halfDay++; break;
        case "ON_LEAVE": onLeave++; break;
        case "ON_DUTY": onDuty++; break;
        case "HOLIDAY": case "WEEKEND": holiday++; break;
      }
    }

    rows.push({
      facultyId: member.uid,
      facultyName: member.name,
      role: ROLE_LABELS[member.role],
      department: member.department,
      totalDays: filled.length,
      present, absent, halfDay, onLeave, onDuty, holiday, lateArrivals,
    });
  }

  rows.sort((a, b) => a.department.localeCompare(b.department) || a.facultyName.localeCompare(b.facultyName));
  return rows;
}
