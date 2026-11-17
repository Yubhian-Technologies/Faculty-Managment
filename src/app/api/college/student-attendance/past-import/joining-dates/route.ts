export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { istDateKey } from "@/lib/attendance/istTime";
import { fetchSectionStudents } from "@/lib/students/sectionRoster";
import { effectiveJoiningDate } from "@/lib/studentAttendance/joiningDate";
import { mayImportSectionAttendance } from "@/lib/studentAttendance/importAccess";
import type { Section } from "@/types";

// The attendance import's "Dates of Joining found in the register" (joiningFromRegister.ts): the page sends, per
// section, each late joiner's first marked date. `apply: false` checks them against the students' details; `apply:
// true` saves the ones the Office / HOD kept ticked - only where the student has NO Date of Joining yet (an entered one
// is never overwritten). Same people and sections as the import itself.
//   { sectionId, apply, items: [{ roll, date }] } -> { items: [{ roll, date, status, existing? }] }
//   status: SET (none yet - will be / was set), SAME (already this date), DIFFERENT (another date is entered - left as
//   it is), NOT_FOUND (no such Regd. No in the section)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITEMS = 500;

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE", "HOD");
    const body = (await readJsonBody(request)) as { sectionId?: unknown; apply?: unknown; items?: unknown };
    const items = Array.isArray(body.items) ? (body.items as { roll?: unknown; date?: unknown }[]) : null;
    if (typeof body.sectionId !== "string" || !body.sectionId) return NextResponse.json({ error: "Select a section." }, { status: 400 });
    if (!items || items.length > MAX_ITEMS || items.some((x) => typeof x?.roll !== "string" || typeof x?.date !== "string" || !DATE_RE.test(x.date))) {
      return NextResponse.json({ error: "Each entry needs a Regd. No and a date (YYYY-MM-DD)." }, { status: 400 });
    }
    const today = istDateKey(new Date());
    if (items.some((x) => (x.date as string) > today)) return NextResponse.json({ error: "A Date of Joining can't be in the future." }, { status: 400 });

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const sectionSnap = await collegeRef.collection("sections").doc(body.sectionId).get();
    if (!sectionSnap.exists) return NextResponse.json({ error: "Section not found. It may have been deleted." }, { status: 404 });
    const section = sectionSnap.data() as Section;
    if (!(await mayImportSectionAttendance(db, session, section))) {
      return NextResponse.json({ error: "This section is not one you manage, so you can't import its attendance." }, { status: 403 });
    }

    const roster = await fetchSectionStudents(collegeRef, { department: section.department, sectionName: section.name, year: section.year, courseId: section.courseId });
    const byRoll = new Map(roster.map((s) => [(s.rollNumber ?? "").trim().toUpperCase(), s]));
    const actor = (await collegeRef.collection("users").doc(session.uid).get()).data() as { name?: string } | undefined;

    const out: { roll: string; date: string; status: "SET" | "SAME" | "DIFFERENT" | "NOT_FOUND"; existing?: string }[] = [];
    for (const it of items) {
      const roll = (it.roll as string).trim();
      const date = it.date as string;
      const st = byRoll.get(roll.toUpperCase());
      if (!st) { out.push({ roll, date, status: "NOT_FOUND" }); continue; }
      const existing = effectiveJoiningDate(st);
      if (existing === date) { out.push({ roll, date, status: "SAME" }); continue; }
      if (existing) { out.push({ roll, date, status: "DIFFERENT", existing }); continue; }
      if (body.apply === true) {
        // Set only while still empty (another save in the meantime wins).
        const ref = collegeRef.collection("students").doc(st.id);
        const done = await db.runTransaction(async (tx) => {
          const fresh = await tx.get(ref);
          if (!fresh.exists || effectiveJoiningDate(fresh.data() as { dateOfJoining?: unknown })) return false;
          tx.update(ref, { dateOfJoining: date, updatedAt: new Date() });
          return true;
        });
        if (!done) { out.push({ roll, date, status: "DIFFERENT" }); continue; }
        await writeAuditLogSafe(db, session.collegeId, {
          action: "STUDENT_DETAILS_UPDATED",
          performedBy: session.uid,
          performedByName: actor?.name,
          targetId: st.id,
          details: { rollNumber: st.rollNumber, fields: ["dateOfJoining"], dateOfJoining: date, via: "Student attendance import (first marked date in the register)" },
        });
      }
      out.push({ roll, date, status: "SET" });
    }
    return NextResponse.json({ items: out });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[student-attendance/past-import/joining-dates POST]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
