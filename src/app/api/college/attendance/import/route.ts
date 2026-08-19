export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { isCollegeStaffUnitHead, unitLabelForHeadRole, COLLEGE_STAFF_UNIT_HEAD_ROLES } from "@/lib/attendance/collegeStaffUnits";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { istDateFromParts, istMidnightUTC } from "@/lib/attendance/istTime";
import { ATTENDANCE_STATUS_LABELS } from "@/types";
import type { AttendanceStatus, UserRole } from "@/types";

type ImportRow = {
  employeeId?: string;
  date?: string;
  status?: string;
  checkIn?: string;
  checkOut?: string;
  remarks?: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Accepts either the raw status code ("PRESENT") or its human label
// ("Present") from the file, case/space-insensitive.
const STATUS_BY_INPUT = new Map<string, AttendanceStatus>();
(Object.keys(ATTENDANCE_STATUS_LABELS) as AttendanceStatus[]).forEach((code) => {
  STATUS_BY_INPUT.set(code.toLowerCase(), code);
  STATUS_BY_INPUT.set(ATTENDANCE_STATUS_LABELS[code].toLowerCase().replace(/\s+/g, ""), code);
});
function parseStatus(raw: string | undefined): AttendanceStatus | null {
  const key = raw?.trim().toLowerCase().replace(/\s+/g, "");
  if (!key) return null;
  return STATUS_BY_INPUT.get(key) ?? null;
}

interface ValidRow {
  row: number;
  employeeId: string;
  uid: string;
  name: string;
  department: string;
  date: Date;
  docSuffix: string;
  status: AttendanceStatus;
  checkIn?: string;
  checkOut?: string;
  remarks?: string;
}

// Bulk-backfills attendance history predating this system (or any other gap)
// directly as real attendanceRecords docs - the exact same one-tier cascade
// every other attendance route in this app already enforces: HOD -> own
// department's Faculty, a unit head (College Office/Exam Cell/Library/T&P)
// -> their own unit's COLLEGE_STAFF (linked by the department field, see
// collegeStaffUnits.ts), PRINCIPAL/VICE_PRINCIPAL -> anyone college-wide.
// Rows are matched to an account by Employee ID, validated, then written -
// never overwriting an existing record (see the skip check below), so this
// can only ever fill a genuine gap, not silently replace real data.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", ...COLLEGE_STAFF_UNIT_HEAD_ROLES);
    const body = (await request.json()) as { records: ImportRow[] };

    if (!body.records || !Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }
    if (body.records.length > 500) {
      return NextResponse.json({ error: "Maximum 500 records per import" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;
    const collegeRef = db.collection("colleges").doc(collegeId);

    // Resolve which roles + (for HOD/unit heads) which department/unit this
    // importer may write into.
    let allowedRoles: UserRole[];
    let departmentFilter: ((dept: string) => boolean) | null = null;

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, collegeId, session.uid);
      const deptNames = new Set([scope.departmentName, ...scope.childDepartmentNames].filter(Boolean));
      allowedRoles = ["PANEL_MEMBER"];
      departmentFilter = (dept) => deptNames.has(dept);
    } else if (isCollegeStaffUnitHead(session.role)) {
      const unitLabel = unitLabelForHeadRole(session.role)!;
      allowedRoles = ["COLLEGE_STAFF"];
      departmentFilter = (dept) => dept === unitLabel;
    } else {
      // PRINCIPAL / VICE_PRINCIPAL - whole college, every attendance-capable role.
      allowedRoles = ["PANEL_MEMBER", "HOD", "COLLEGE_STAFF", ...COLLEGE_STAFF_UNIT_HEAD_ROLES];
    }

    // Resolve every in-scope account by Employee ID, once. An HOD may also
    // import their own record (their own uid specifically, not just any HOD
    // - never a sub-HOD's) regardless of the Faculty-only role/department
    // filter above, since it's an exact, unambiguous match rather than a
    // scope expansion.
    const usersSnap = await collegeRef.collection("users").get();
    const byEmployeeId = new Map<string, { uid: string; name: string; department: string }>();
    for (const doc of usersSnap.docs) {
      const u = doc.data() as { name?: string; department?: string; role?: UserRole; employeeId?: string };
      if (!u.employeeId?.trim() || !u.role) continue;
      const isHodSelf = session.role === "HOD" && doc.id === session.uid;
      if (!isHodSelf) {
        if (!allowedRoles.includes(u.role)) continue;
        if (departmentFilter && !departmentFilter(u.department ?? "")) continue;
      }
      byEmployeeId.set(u.employeeId.trim().toLowerCase(), { uid: doc.id, name: u.name ?? "", department: u.department ?? "" });
    }

    const todayStart = istMidnightUTC(new Date());

    const failed: { row: number; employeeId: string; error: string }[] = [];
    const validRows: ValidRow[] = [];

    for (let i = 0; i < body.records.length; i++) {
      const r = body.records[i];
      const rowNum = i + 2; // 1-indexed + header row
      const employeeId = r.employeeId?.trim() ?? "";
      if (!employeeId) {
        failed.push({ row: rowNum, employeeId: "-", error: "Employee ID is required" });
        continue;
      }

      const match = byEmployeeId.get(employeeId.toLowerCase());
      if (!match) {
        failed.push({ row: rowNum, employeeId, error: "No matching staff account found in your scope for this Employee ID" });
        continue;
      }

      const dateStr = r.date?.trim() ?? "";
      if (!DATE_RE.test(dateStr)) {
        failed.push({ row: rowNum, employeeId, error: `Date must be YYYY-MM-DD, got "${r.date ?? ""}"` });
        continue;
      }
      const [y, m, d] = dateStr.split("-").map(Number);
      // Overflow check only (e.g. rejects Feb 30) - a plain local Date is
      // fine here since we only inspect whether the components round-trip,
      // not which calendar day it represents.
      const overflowCheck = new Date(y, m - 1, d);
      if (Number.isNaN(overflowCheck.getTime()) || overflowCheck.getMonth() !== m - 1) {
        failed.push({ row: rowNum, employeeId, error: `"${dateStr}" is not a valid date` });
        continue;
      }
      const date = istDateFromParts(y, m, d);
      if (date >= todayStart) {
        failed.push({ row: rowNum, employeeId, error: "Date must be in the past - today or future dates aren't allowed via import" });
        continue;
      }

      const status = parseStatus(r.status);
      if (!status) {
        failed.push({ row: rowNum, employeeId, error: `Status "${r.status ?? ""}" isn't recognized (use Present, Absent, Half Day, On Leave, On Duty, or Holiday)` });
        continue;
      }

      const checkIn = r.checkIn?.trim() || undefined;
      const checkOut = r.checkOut?.trim() || undefined;
      if (checkIn && !TIME_RE.test(checkIn)) {
        failed.push({ row: rowNum, employeeId, error: `Check In must be HH:MM, got "${checkIn}"` });
        continue;
      }
      if (checkOut && !TIME_RE.test(checkOut)) {
        failed.push({ row: rowNum, employeeId, error: `Check Out must be HH:MM, got "${checkOut}"` });
        continue;
      }
      if (checkIn && checkOut && checkOut <= checkIn) {
        failed.push({ row: rowNum, employeeId, error: "Check Out must be after Check In" });
        continue;
      }

      validRows.push({
        row: rowNum, employeeId, uid: match.uid, name: match.name, department: match.department,
        date, docSuffix: dateStr, status, checkIn, checkOut, remarks: r.remarks?.trim() || undefined,
      });
    }

    // Never overwrite an existing record - check every valid row's doc id in
    // parallel, then only queue the ones with no existing document.
    const existingSnaps = await Promise.all(
      validRows.map((vr) => collegeRef.collection("attendanceRecords").doc(`${vr.uid}_${vr.docSuffix}`).get())
    );

    const skipped: { row: number; employeeId: string; date: string; reason: string }[] = [];
    const batch = new ChunkedBatch(db);
    const now = new Date();
    let created = 0;

    validRows.forEach((vr, i) => {
      if (existingSnaps[i].exists) {
        skipped.push({ row: vr.row, employeeId: vr.employeeId, date: vr.docSuffix, reason: "Already has an attendance record for this date" });
        return;
      }
      batch.set(collegeRef.collection("attendanceRecords").doc(`${vr.uid}_${vr.docSuffix}`), {
        collegeId, facultyId: vr.uid, facultyName: vr.name, department: vr.department,
        date: vr.date, status: vr.status,
        ...(vr.checkIn ? { checkIn: vr.checkIn } : {}),
        ...(vr.checkOut ? { checkOut: vr.checkOut } : {}),
        source: "IMPORTED", markedBy: session.uid,
        remarks: vr.remarks ?? "Imported historical record",
        createdAt: now, updatedAt: now,
      });
      created++;
    });

    if (created > 0) {
      await batch.commit();
      let importerName = "Unknown";
      try {
        const s = await collegeRef.collection("users").doc(session.uid).get();
        importerName = (s.data() as { name?: string } | undefined)?.name ?? importerName;
      } catch { /* best-effort */ }
      await collegeRef.collection("auditLogs").add({
        collegeId, action: "ATTENDANCE_IMPORTED", performedBy: session.uid, performedByName: importerName,
        details: { created, skipped: skipped.length, failed: failed.length },
        timestamp: now,
      });
    }

    return NextResponse.json({ created, skipped, failed }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/attendance/import POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
