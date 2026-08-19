export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { currentTimetableAcademicYear } from "@/lib/college/academicSession";
import { HOLIDAY_TYPE_LABELS } from "@/types";
import type { HolidayAudience, HolidayType } from "@/types";

interface ImportRow {
  sno?: string;
  occasion?: string;
  date?: string;
  type?: string;
}

// code (NATIONAL) or label (National) accepted, case-insensitive - matches
// what a user is likely to type into the Type column either way.
const TYPE_BY_INPUT = new Map<string, HolidayType>();
for (const code of Object.keys(HOLIDAY_TYPE_LABELS) as HolidayType[]) {
  TYPE_BY_INPUT.set(code.toLowerCase(), code);
  TYPE_BY_INPUT.set(HOLIDAY_TYPE_LABELS[code].toLowerCase(), code);
}

// Bulk alternative to holidays/route.ts POST's one-at-a-time Add Holiday -
// matches the S.No/Occasion/Date/Type CSV template (see
// lib/college/holidayImportColumns.ts). Every imported row applies to BOTH
// (the template has no Applies To column) - edit an individual one
// afterward from the Holidays list if it needs to be students-only. Same
// role gate as the single-add route.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE");
    const body = (await request.json()) as { records?: ImportRow[] };
    const records = body.records;

    if (!records || !Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }
    if (records.length > 500) {
      return NextResponse.json({ error: "Maximum 500 records per import" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;
    const now = new Date();

    const failed: { row: number; identifier: string; error: string }[] = [];
    const toCreate: { date: Date; name: string; type: HolidayType; academicYear: string }[] = [];

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 2; // 1-indexed + header row
      const occasion = row.occasion?.trim() ?? "";
      const identifier = occasion || (row.sno?.trim() ? `row ${row.sno.trim()}` : `row ${rowNum}`);

      if (!occasion) {
        failed.push({ row: rowNum, identifier, error: "Occasion is required" });
        continue;
      }
      const rawDate = row.date?.trim() ?? "";
      const date = rawDate ? new Date(rawDate) : null;
      if (!date || Number.isNaN(date.getTime())) {
        failed.push({ row: rowNum, identifier, error: `Date must be a valid date (e.g. 2026-08-15), got "${rawDate}"` });
        continue;
      }
      const rawType = row.type?.trim() ?? "";
      const type = rawType ? TYPE_BY_INPUT.get(rawType.toLowerCase()) : "COLLEGE";
      if (!type) {
        failed.push({ row: rowNum, identifier, error: `Type must be National, Regional, College or Restricted, got "${rawType}"` });
        continue;
      }
      toCreate.push({ date, name: occasion, type, academicYear: currentTimetableAcademicYear(date) });
    }

    const holidaysRef = db.collection("colleges").doc(collegeId).collection("holidays");
    let created = 0;
    for (const h of toCreate) {
      await holidaysRef.add({
        collegeId,
        date: h.date,
        name: h.name,
        type: h.type,
        appliesTo: "BOTH" as HolidayAudience,
        academicYear: h.academicYear,
        createdAt: now,
      });
      created++;
    }

    if (created > 0) {
      await db.collection("colleges").doc(collegeId).collection("auditLogs").add({
        collegeId,
        action: "HOLIDAYS_IMPORTED",
        performedBy: session.uid,
        details: { created, failed: failed.length },
        timestamp: now,
      });
    }

    return NextResponse.json({ created, failed }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/holidays/import POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
