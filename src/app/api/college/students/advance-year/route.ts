export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import type { Firestore } from "firebase-admin/firestore";
import type { Section, StudentRecord } from "@/types";

// Moves a whole year's cohort up to the next year, keeping every student in
// the SAME branch and the SAME section letter - "the same students, same
// branches and same sections move to next year". After a shared first year
// this is what hands each branch's cohort back to its own core HOD, but it is
// deliberately not first-year-specific: any year advances the same way.
//
// Target sections must already exist. Rather than inventing sections on a
// Principal's behalf, a run that would land students nowhere refuses and names
// exactly which (branch, year, section) rows are missing, so the core HODs can
// create them first. `dryRun` returns that same report with a 200 so the UI can
// preflight before anyone commits.
//
// Per-student moves and graduation stay in college/students/promote.

interface MissingSection {
  department: string;
  year: number;
  section: string;
  students: number;
}

async function getUserName(db: Firestore, collegeId: string, uid: string): Promise<string> {
  try {
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
    return (snap.data() as { name?: string } | undefined)?.name ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as { fromYear?: number; dryRun?: boolean };

    const fromYear = Number(body.fromYear);
    if (!fromYear || !Number.isFinite(fromYear) || fromYear < 1) {
      return NextResponse.json({ error: "fromYear is required" }, { status: 400 });
    }
    const toYear = fromYear + 1;

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // Only REGULAR students advance - DETAINED students stay put by definition,
    // and GRADUATED ones are done. Matches college/students/promote.
    const cohortSnap = await collegeRef.collection("students").where("year", "==", fromYear).get();
    const cohort = cohortSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<StudentRecord, "id">) }))
      .filter((s) => s.status === "REGULAR" && (s.department ?? "").trim() && (s.section ?? "").trim());

    if (cohort.length === 0) {
      return NextResponse.json(
        { error: `No eligible (REGULAR, sectioned) students in year ${fromYear}` },
        { status: 400 }
      );
    }

    // Index the destination year's sections by branch + section name.
    const targetSnap = await collegeRef.collection("sections").where("year", "==", toYear).get();
    const targetByKey = new Map<string, Section>();
    for (const d of targetSnap.docs) {
      const s = { id: d.id, ...(d.data() as object) } as Section;
      targetByKey.set(`${(s.department ?? "").trim()}|${(s.name ?? "").trim().toUpperCase()}`, s);
    }

    // Group the cohort by where each student needs to land.
    const groups = new Map<string, { department: string; section: string; students: typeof cohort }>();
    for (const student of cohort) {
      const department = student.department.trim();
      const section = student.section.trim();
      const key = `${department}|${section.toUpperCase()}`;
      const group = groups.get(key);
      if (group) group.students.push(student);
      else groups.set(key, { department, section, students: [student] });
    }

    const missing: MissingSection[] = [];
    for (const [key, group] of groups) {
      if (!targetByKey.has(key)) {
        missing.push({
          department: group.department,
          year: toYear,
          section: group.section,
          students: group.students.length,
        });
      }
    }

    if (missing.length > 0) {
      missing.sort((a, b) => a.department.localeCompare(b.department) || a.section.localeCompare(b.section));
      const summary = missing.map((m) => `${m.department} Year ${m.year} Section ${m.section}`).join(", ");
      // Nothing is written - the whole cohort advances together or not at all,
      // so a half-advanced year can't be left behind.
      return NextResponse.json(
        {
          error: `Create these sections first, then advance again: ${summary}`,
          missing,
          eligible: cohort.length,
        },
        { status: 409 }
      );
    }

    const preview = {
      fromYear,
      toYear,
      eligible: cohort.length,
      groups: Array.from(groups.values())
        .map((g) => ({ department: g.department, section: g.section, students: g.students.length }))
        .sort((a, b) => a.department.localeCompare(b.department) || a.section.localeCompare(b.section)),
      missing: [] as MissingSection[],
    };

    if (body.dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, ...preview });
    }

    const now = new Date();
    // ChunkedBatch rotates at Firestore's 500-op ceiling, so a college-wide
    // cohort (well past promote's 400-per-call cap) advances in one request.
    const batch = new ChunkedBatch(db);
    for (const group of groups.values()) {
      for (const student of group.students) {
        batch.update(collegeRef.collection("students").doc(student.id), {
          // department and section are deliberately untouched - only the year
          // moves. secondaryDepartment is cleared for the same reason
          // college/students/promote clears it: once a student is in their own
          // branch's year, a pre-registration pointer is redundant.
          year: toYear,
          secondaryDepartment: null,
          updatedAt: now,
        });
        const history = departmentHistoryEntry(
          db, session.collegeId, student.id, group.department, group.section, toYear, now
        );
        batch.set(history.ref, history.data);
      }
    }

    await batch.commit();

    const performedByName = await getUserName(db, session.collegeId, session.uid);
    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "STUDENT_PROMOTED",
      performedBy: session.uid,
      performedByName,
      details: {
        kind: "COHORT_ADVANCED",
        fromYear,
        toYear,
        count: cohort.length,
        groups: preview.groups,
      },
      timestamp: now,
    });

    return NextResponse.json({ ok: true, ...preview, advanced: cohort.length });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/advance-year POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
