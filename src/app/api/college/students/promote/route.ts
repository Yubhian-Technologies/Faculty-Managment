export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Firestore } from "firebase-admin/firestore";
import type { Section, StudentRecord } from "@/types";

const MAX_STUDENTS_PER_CALL = 400;

async function getUserName(db: Firestore, collegeId: string, uid: string): Promise<string> {
  try {
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
    return (snap.data() as { name?: string } | undefined)?.name ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

// Principal/VP move a cohort of REGULAR students to a different department's
// section for the next year (PROMOTE), or mark a final-year cohort complete
// (GRADUATE). Targets a single destination per call — the "bulk-by-section
// with per-student override" UX (src/app/(dashboard)/principal/promotions)
// groups students by their resolved target and fires one call per group.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      studentIds: string[];
      action: "PROMOTE" | "GRADUATE";
      targetSectionId?: string;
    };

    const studentIds = Array.isArray(body.studentIds) ? body.studentIds : [];
    if (studentIds.length === 0) {
      return NextResponse.json({ error: "studentIds is required" }, { status: 400 });
    }
    if (studentIds.length > MAX_STUDENTS_PER_CALL) {
      return NextResponse.json(
        { error: `At most ${MAX_STUDENTS_PER_CALL} students per call — split into multiple requests` },
        { status: 400 }
      );
    }
    if (body.action !== "PROMOTE" && body.action !== "GRADUATE") {
      return NextResponse.json({ error: "action must be PROMOTE or GRADUATE" }, { status: 400 });
    }
    if (body.action === "PROMOTE" && !body.targetSectionId) {
      return NextResponse.json({ error: "targetSectionId is required for PROMOTE" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    let targetSection: Section | null = null;
    if (body.action === "PROMOTE") {
      const targetSnap = await collegeRef.collection("sections").doc(body.targetSectionId!).get();
      if (!targetSnap.exists) {
        return NextResponse.json({ error: "Target section not found" }, { status: 404 });
      }
      targetSection = { id: targetSnap.id, ...(targetSnap.data() as object) } as Section;
    }

    const studentSnaps = await Promise.all(
      studentIds.map((id) => collegeRef.collection("students").doc(id).get())
    );

    const now = new Date();
    const batch = db.batch();
    let updatedCount = 0;
    const skipped: string[] = [];

    for (const snap of studentSnaps) {
      if (!snap.exists) {
        skipped.push(snap.id);
        continue;
      }
      const student = snap.data() as StudentRecord;
      if (student.status !== "REGULAR") {
        skipped.push(snap.id);
        continue;
      }

      if (body.action === "GRADUATE") {
        batch.update(snap.ref, { status: "GRADUATED", updatedAt: now });
      } else {
        batch.update(snap.ref, {
          department: targetSection!.department,
          year: targetSection!.year,
          section: targetSection!.name,
          updatedAt: now,
        });
      }
      updatedCount++;
    }

    if (updatedCount === 0) {
      return NextResponse.json({ error: "No eligible (REGULAR) students to update" }, { status: 400 });
    }

    await batch.commit();

    const performedByName = await getUserName(db, session.collegeId, session.uid);
    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: body.action === "GRADUATE" ? "STUDENT_GRADUATED" : "STUDENT_PROMOTED",
      performedBy: session.uid,
      performedByName,
      details: {
        count: updatedCount,
        skipped: skipped.length,
        ...(targetSection ? { toSectionId: targetSection.id, toDepartment: targetSection.department, toYear: targetSection.year } : {}),
      },
      timestamp: now,
    });

    return NextResponse.json({ ok: true, updatedCount, skipped });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/promote POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
