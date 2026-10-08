export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import type { SubjectCategory, SubjectType } from "@/types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS");
    const { id } = await params;
    const body = (await readJsonBody(request)) as {
      name?: string;
      code?: string;
      shortCode?: string;
      altShortCode?: string;
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
      /** "Don't include in teaching load" - kept off teaching load and the resume; still timetabled, assigned and attended. */
      excludeFromTeachingLoad?: boolean;
    };

    // Import accepts any free-text category as a valid custom category (see
    // SubjectValidator.ts) and stores it raw - SubjectCategory is typed as
    // StandardSubjectCategory | (string & {}) for exactly this reason. Gating
    // on SUBJECT_CATEGORY_LABELS membership here rejected every subsequent
    // edit to an import-created subject that kept its custom category,
    // including edits that didn't touch category at all.
    if (body.category != null && !body.category.trim()) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }
    if (body.category === "OTHER" && !body.customCategory?.trim()) {
      return NextResponse.json({ error: "Enter a name for the custom category" }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("subjects").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Academics/Principal/Super Admin manage subjects across every department by
    // design (see academics/subjects/page.tsx - no per-row ownership guard there);
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
    if (body.shortCode != null) updates.shortCode = body.shortCode.trim().toUpperCase();
    // Second short code: display-only, picked per placed period in the timetable editor, so no cascade.
    if (body.altShortCode != null) updates.altShortCode = body.altShortCode.trim().toUpperCase();
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
    // Stored as the existing isNonTeachingLoad/excludeFromResume pair, which every
    // teaching-load view and the resume already honour.
    const loadFlags = body.excludeFromTeachingLoad == null ? null
      : body.excludeFromTeachingLoad
        ? { isNonTeachingLoad: true, excludeFromResume: true }
        : { isNonTeachingLoad: FieldValue.delete(), excludeFromResume: FieldValue.delete() };
    if (loadFlags) Object.assign(updates, loadFlags);

    await ref.update(updates);

    // The flag is copied onto every assignment and department semester row at
    // creation, so changing it here must reach the existing ones too.
    if (loadFlags) {
      const collegeRef = db.collection("colleges").doc(session.collegeId);
      const targets = (await Promise.all(
        (["teachingAssignments", "subjectSemesterAssignments"] as const).map((c) =>
          collegeRef.collection(c).where("subjectId", "==", id).get()
        ),
      )).flatMap((s) => s.docs);
      for (let i = 0; i < targets.length; i += 400) {
        const batch = db.batch();
        for (const doc of targets.slice(i, i + 400)) batch.update(doc.ref, { ...loadFlags, updatedAt: new Date() });
        await batch.commit();
      }
    }

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
    const shortCodeChanged = body.shortCode != null;
    if (body.hoursPerWeek != null || nameChanged || codeChanged || shortCodeChanged) {
      const newHours = body.hoursPerWeek != null ? Number(body.hoursPerWeek) : undefined;
      const newName = nameChanged ? String(updates.name) : undefined;
      const newCode = codeChanged ? String(updates.code) : undefined;
      const newShortCode = shortCodeChanged ? String(updates.shortCode) : undefined;
      const now = new Date();

      const assignmentFields: Record<string, unknown> = { updatedAt: now };
      if (newHours != null) assignmentFields.hoursPerWeek = newHours;
      if (newName != null) assignmentFields.subjectName = newName;
      if (newCode != null) assignmentFields.subjectCode = newCode;
      if (newShortCode != null) assignmentFields.shortCode = newShortCode;

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
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
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
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS");
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
    // assignments, OR a department instance made from it (subjectSemesterAssignments,
    // doc id `${subjectId}_${departmentId}` - see SubjectInstanceService) -
    // deleting the doc out from under either would orphan it (subjectId
    // pointing at nothing, and any future re-fetch of the subject 404ing).
    // An instance can exist with no teaching assignment yet (an HOD
    // instantiated it into their department's semester but hasn't staffed it),
    // so the instance check has to run independently, not just as a side
    // effect of the assignment one. Deactivate (isActive: false) instead,
    // which keeps the record - and everything that names it - intact.
    const [assignmentSnap, instanceSnap] = await Promise.all([
      db.collection("colleges").doc(session.collegeId)
        .collection("teachingAssignments")
        .where("subjectId", "==", id)
        .limit(1)
        .get(),
      db.collection("colleges").doc(session.collegeId)
        .collection("subjectSemesterAssignments")
        .where("subjectId", "==", id)
        .limit(1)
        .get(),
    ]);
    if (!assignmentSnap.empty) {
      return NextResponse.json(
        {
          error:
            "This subject still has active teaching assignments. Remove/reassign them first, or mark the subject inactive instead of deleting it.",
        },
        { status: 409 }
      );
    }
    if (!instanceSnap.empty) {
      return NextResponse.json(
        {
          error:
            "This subject is still assigned to a department's semester. Unassign it from Assign to Semester first, or mark it inactive instead of deleting it.",
        },
        { status: 409 }
      );
    }

    await ref.delete();
    return NextResponse.json({ success: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[subjects/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
