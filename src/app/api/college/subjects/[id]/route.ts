export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import type { SubjectCategory, SubjectType } from "@/types";
import { SUBJECT_CATEGORY_LABELS } from "@/types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN", "DEAN");
    const { id } = await params;
    const body = (await request.json()) as {
      name?: string;
      code?: string;
      hoursPerWeek?: number;
      totalHoursPerSemester?: number | null;
      credits?: number;
      type?: SubjectType;
      isActive?: boolean;
      serialNumber?: number;
      category?: SubjectCategory;
      customCategory?: string;
      lectureHours?: number;
      tutorialHours?: number;
      practicalHours?: number;
    };

    if (body.category != null && !(body.category in SUBJECT_CATEGORY_LABELS)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }
    if (body.category === "OTHER" && !body.customCategory?.trim()) {
      return NextResponse.json({ error: "Enter a name for the custom category" }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("subjects").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Dean/Principal/Super Admin manage subjects across every department by
    // design (see dean/subjects/page.tsx - no per-row ownership guard there);
    // only an HOD is restricted to their own department/sub-departments. This
    // was previously unchecked entirely - any authenticated HOD could edit
    // any other department's subject via a direct request, the UI's own
    // "isOwnDepartment" hide-the-buttons check being client-side only.
    if (session.role === "HOD") {
      const subjectDept = (snap.data() as { department?: string }).department;
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!subjectDept || !canHodEditDepartment(scope, subjectDept)) {
        return NextResponse.json(
          { error: "That subject is not in your department or one of your sub-departments" },
          { status: 403 },
        );
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name != null) updates.name = body.name.trim();
    if (body.code != null) updates.code = body.code.toUpperCase().trim();
    if (body.hoursPerWeek != null) updates.hoursPerWeek = Number(body.hoursPerWeek);
    if ("totalHoursPerSemester" in body) updates.totalHoursPerSemester = body.totalHoursPerSemester ?? null;
    if (body.credits != null) updates.credits = Number(body.credits);
    if (body.type != null) updates.type = body.type;
    if (body.isActive != null) updates.isActive = body.isActive;
    if (body.serialNumber != null) updates.serialNumber = Number(body.serialNumber);
    if (body.category != null) {
      updates.category = body.category;
      updates.customCategory = body.category === "OTHER" ? body.customCategory!.trim() : null;
    }
    if (body.lectureHours != null) updates.lectureHours = Number(body.lectureHours);
    if (body.tutorialHours != null) updates.tutorialHours = Number(body.tutorialHours);
    if (body.practicalHours != null) updates.practicalHours = Number(body.practicalHours);

    await ref.update(updates);

    // hoursPerWeek is shown/edited from multiple places (the Subjects page and every
    // faculty member's teaching-assignment editor) but is owned here - cascade it to every
    // existing teaching assignment for this subject so all of them (and the period-count
    // cap in their editors) stay in sync.
    //
    // subjectName/subjectCode are cascaded the same way, for the same reason:
    // they're copied into teachingAssignments/timetableSlots at
    // assignment-creation time and never re-read afterward, so a rename here
    // would otherwise leave every existing assignment/slot showing the old
    // name/code forever. Historical Tier-2 snapshots (internal marks,
    // attendance sessions, etc.) are deliberately NOT touched - those are
    // point-in-time records, not live state.
    const nameChanged = body.name != null;
    const codeChanged = body.code != null;
    if (body.hoursPerWeek != null || nameChanged || codeChanged) {
      const newHours = body.hoursPerWeek != null ? Number(body.hoursPerWeek) : undefined;
      const newName = nameChanged ? String(updates.name) : undefined;
      const newCode = codeChanged ? String(updates.code) : undefined;
      const now = new Date();

      const assignmentFields: Record<string, unknown> = { updatedAt: now };
      if (newHours != null) assignmentFields.hoursPerWeek = newHours;
      if (newName != null) assignmentFields.subjectName = newName;
      if (newCode != null) assignmentFields.subjectCode = newCode;

      const assignmentsSnap = await db
        .collection("colleges").doc(session.collegeId)
        .collection("teachingAssignments")
        .where("subjectId", "==", id)
        .get();
      for (let i = 0; i < assignmentsSnap.docs.length; i += 400) {
        const chunk = assignmentsSnap.docs.slice(i, i + 400);
        const batch = db.batch();
        for (const doc of chunk) batch.update(doc.ref, assignmentFields);
        await batch.commit();
      }

      if (newName != null) {
        // TimetableSlot carries subjectName only (no subjectCode field on
        // this collection - see types/teaching.ts's TimetableSlot).
        const slotFields: Record<string, unknown> = { updatedAt: now, subjectName: newName };

        const slotsSnap = await db
          .collection("colleges").doc(session.collegeId)
          .collection("timetableSlots")
          .where("subjectId", "==", id)
          .get();
        for (let i = 0; i < slotsSnap.docs.length; i += 400) {
          const chunk = slotsSnap.docs.slice(i, i + 400);
          const batch = db.batch();
          for (const doc of chunk) batch.update(doc.ref, slotFields);
          await batch.commit();
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[subjects/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN", "DEAN");
    const { id } = await params;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("subjects").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (session.role === "HOD") {
      const subjectDept = (snap.data() as { department?: string }).department;
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!subjectDept || !canHodEditDepartment(scope, subjectDept)) {
        return NextResponse.json(
          { error: "That subject is not in your department or one of your sub-departments" },
          { status: 403 },
        );
      }
    }

    // Refuse to hard-delete a subject that still has live teaching
    // assignments - deleting the doc out from under them would orphan every
    // one of those (subjectId pointing at nothing, and any future re-fetch of
    // the subject 404ing). Deactivate (isActive: false) instead, which keeps
    // the record - and every assignment that names it - intact.
    const assignmentSnap = await db
      .collection("colleges").doc(session.collegeId)
      .collection("teachingAssignments")
      .where("subjectId", "==", id)
      .limit(1)
      .get();
    if (!assignmentSnap.empty) {
      return NextResponse.json(
        {
          error:
            "This subject still has active teaching assignments. Remove/reassign them first, or mark the subject inactive instead of deleting it.",
        },
        { status: 409 }
      );
    }

    await ref.delete();
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[subjects/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
