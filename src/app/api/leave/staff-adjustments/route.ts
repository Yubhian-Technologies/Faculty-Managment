export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveFacultyMemberId, resolveLoginUidForFacultyMember } from "@/lib/faculty/resolveFacultyMemberId";
import { getHolidayDateKeys } from "@/lib/leave/holidaysCount";
import { todayISODate } from "@/lib/leave/dayCounter";
import { validatePeriodSubstitutions, type PeriodSubstitutionInput } from "@/lib/leave/periodCoverage";
import {
  isAdjustmentManager, listAdjustableSubjects, listCoverCandidates, resolveManagerDepartments,
} from "@/lib/leave/staffAdjustmentScope";
import { notify } from "@/lib/notify";
import type { FacultyMember } from "@/types";
import type { PeriodSubstitution, StaffAdjustment } from "@/types/leave";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function newestFirst<T extends { createdAt?: unknown }>(items: T[]): T[] {
  const ms = (v: unknown) => (v as { toMillis?(): number })?.toMillis?.() ?? 0;
  return [...items].sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
}

// Adjustments the caller arranged. A Principal / Vice Principal see every
// adjustment in the college (they sit above every other manager); an HOD or
// College Office member sees the ones they created themselves.
export async function GET() {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "COLLEGE_OFFICE");
    if (!isAdjustmentManager(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const db = getAdminDb();

    const col = db.collection("colleges").doc(session.collegeId).collection("staffAdjustments");
    const snap = session.role === "PRINCIPAL" || session.role === "VICE_PRINCIPAL"
      ? await col.get()
      : await col.where("createdBy", "==", session.uid).get();

    const adjustments = newestFirst(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StaffAdjustment));
    return NextResponse.json({ adjustments });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/staff-adjustments GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "COLLEGE_OFFICE");
    if (!isAdjustmentManager(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const manager = { uid: session.uid, role: session.role };

    const body = (await request.json()) as {
      subjectUid?: string;
      fromDate?: string;
      toDate?: string;
      reason?: string;
      periodSubstitutions?: PeriodSubstitutionInput[];
      coverUid?: string;
    };
    const { subjectUid, fromDate: fromISO, toDate: toISO } = body;
    const reason = body.reason?.trim();
    if (!subjectUid || !fromISO || !toISO || !reason) {
      return NextResponse.json({ error: "subjectUid, fromDate, toDate and reason are required" }, { status: 400 });
    }
    if (!ISO_DATE_RE.test(fromISO) || !ISO_DATE_RE.test(toISO) || toISO < fromISO) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }
    if (fromISO < todayISODate()) {
      return NextResponse.json({ error: "An adjustment can't start before today" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const subjects = await listAdjustableSubjects(db, session.collegeId, manager);
    const subject = subjects.find((s) => s.uid === subjectUid);
    if (!subject) {
      return NextResponse.json({ error: "That person isn't one you can adjust" }, { status: 403 });
    }

    // One adjustment at a time per person over any given day - a second,
    // overlapping one would leave it unclear who is actually covering what.
    const existing = await collegeRef.collection("staffAdjustments").where("subjectUid", "==", subjectUid).get();
    const overlapping = existing.docs.some((d) => {
      const a = d.data() as StaffAdjustment;
      return a.status === "ACTIVE" && a.fromDate <= toISO && fromISO <= a.toDate;
    });
    if (overlapping) {
      return NextResponse.json(
        { error: `${subject.name} already has an adjustment covering some of these dates. Cancel it first or pick different dates.` },
        { status: 409 }
      );
    }

    const fromDate = new Date(fromISO);
    const toDate = new Date(toISO);
    const departments = await resolveManagerDepartments(db, session.collegeId, manager);

    let periodSubstitutions: PeriodSubstitution[] = [];
    if (body.periodSubstitutions?.length) {
      const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, subject.uid);
      const holidayDates = await getHolidayDateKeys(db, session.collegeId, fromDate, toDate);
      const result = await validatePeriodSubstitutions({
        db, collegeId: session.collegeId, facultyMemberId, department: subject.department,
        fromDate, toDate, holidayDates, submitted: body.periodSubstitutions, mode: "PARTIAL",
        assignedByOverride: "MANAGER",
        coverageOptions: { candidateFilter: departments ? (f: FacultyMember) => departments.includes(f.department ?? "") : undefined },
      });
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      periodSubstitutions = result.resolved;
    }

    let cover: { uid: string; name: string } | null = null;
    if (body.coverUid) {
      const candidates = await listCoverCandidates(db, session.collegeId, manager, subject, { fromISO, toISO });
      const match = candidates.find((c) => c.uid === body.coverUid);
      if (!match) {
        return NextResponse.json(
          { error: "That person can't cover for them - they may be on leave, already tied up, or outside your scope." },
          { status: 400 }
        );
      }
      cover = { uid: match.uid, name: match.name };
    }

    if (periodSubstitutions.length === 0 && !cover) {
      return NextResponse.json({ error: "Name who covers at least one period, or who covers their other duties" }, { status: 400 });
    }

    const actorSnap = await collegeRef.collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? session.email ?? "Unknown";
    const now = new Date();

    const doc: Omit<StaffAdjustment, "id"> = {
      collegeId: session.collegeId,
      createdBy: session.uid,
      createdByName: actorName,
      createdByRole: session.role,
      subjectUid: subject.uid,
      subjectName: subject.name,
      subjectRole: subject.role,
      ...(subject.department ? { department: subject.department } : {}),
      fromDate: fromISO,
      toDate: toISO,
      reason,
      ...(periodSubstitutions.length > 0 ? { periodSubstitutions } : {}),
      ...(cover ? { coverUid: cover.uid, coverName: cover.name } : {}),
      status: "ACTIVE",
      createdAt: now as unknown as StaffAdjustment["createdAt"],
    };
    const ref = await collegeRef.collection("staffAdjustments").add(doc);

    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "STAFF_ADJUSTMENT_CREATED" as string,
      performedBy: session.uid,
      performedByName: actorName,
      targetId: ref.id,
      details: {
        subject: subject.name, fromDate: fromISO, toDate: toISO,
        periods: periodSubstitutions.length, ...(cover ? { cover: cover.name } : {}),
      },
      timestamp: now,
    });

    const span = fromISO === toISO ? fromISO : `${fromISO} to ${toISO}`;
    await notify(
      db, session.collegeId, subject.uid, "STAFF_ADJUSTMENT", "Adjustment arranged for you",
      `${actorName} has arranged cover for you on ${span}${periodSubstitutions.length ? ` (${periodSubstitutions.length} period(s))` : ""}. Reason: ${reason}`
    );
    if (cover) {
      await notify(
        db, session.collegeId, cover.uid, "STAFF_ADJUSTMENT", "You're covering for a colleague",
        `${actorName} has asked you to cover ${subject.name}'s duties on ${span}. Reason: ${reason}`
      );
    }
    const byFaculty = new Map<string, PeriodSubstitution[]>();
    for (const p of periodSubstitutions) {
      byFaculty.set(p.substituteFacultyId, [...(byFaculty.get(p.substituteFacultyId) ?? []), p]);
    }
    for (const [facultyId, periods] of byFaculty) {
      const uid = await resolveLoginUidForFacultyMember(db, session.collegeId, facultyId);
      if (!uid || uid === facultyId) continue; // no login yet - nothing to notify
      const shown = periods.slice(0, 3).map((p) => `${p.subjectName} (${p.day} P${p.periodNumber}, ${p.date})`).join("; ");
      const rest = periods.length > 3 ? ` and ${periods.length - 3} more` : "";
      await notify(
        db, session.collegeId, uid, "SUBSTITUTE_ASSIGNED", "You're covering a class",
        `${actorName} has assigned you to cover ${subject.name}'s: ${shown}${rest}.`, "/panel/teaching"
      );
    }

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/staff-adjustments POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
