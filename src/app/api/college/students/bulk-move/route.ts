export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { invalidateSectionCountCache } from "@/lib/students/sectionCounts";
import { NextResponse } from "next/server";
import { actorOf } from "@/lib/audit/actorOf";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { canHodEditDepartmentYear, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import { structureFromDepartments, type DepartmentWithId } from "@/lib/college/academicStructure";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { findCurrentSectionDoc } from "@/lib/students/findCurrentSectionDoc";
import { planSectionMove } from "@/lib/students/sectionMove";
import type { Section, StudentRecord } from "@/types";

// Manual, hand-picked Move / Assign for MANY students at once - the bulk
// counterpart of students/[id] PATCH's single move, for the department's own
// HOD picking rows on the Students page (as opposed to students/distribute,
// which splits a whole cohort by surname).
//
//   { studentIds, targetSectionId }   put them all into that section
//   { studentIds, unassign: true }    pull them all back to "Unassigned"
//   dryRun: true                      compute and return the plan, write nothing
//
// Safe by construction:
//  - Every student is judged on their own (planSectionMove: same year, the
//    section must feed their branch, no roll clash, ...) and the HOD scope is
//    checked per student AND for the target section. Whoever fails is reported
//    with a reason and left exactly as they were.
//  - Everything that passes is written in ONE atomic batch - the student update
//    and its department-history entry together - so a failure moves nobody.
//  - The UI always previews with dryRun first; the commit re-validates against
//    fresh data, so a stale preview can't move someone it shouldn't.
//
// Same role tier as the roll-number / unassign edits: the department's own
// structural decision, so Office and Panel Members stay out.
const MAX_STUDENTS = 200; // 2 writes per student must fit one 500-write batch

interface MoveRow { id: string; name: string; rollNumber: string; from: string; to: string }
interface SkipRow { id: string; name: string; reason: string }

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    invalidateSectionCountCache(session.collegeId); // student counts on the Sections list change with this write
    const body = (await readJsonBody(request)) as {
      studentIds?: unknown;
      targetSectionId?: unknown;
      unassign?: unknown;
      dryRun?: unknown;
    };

    const ids = Array.isArray(body.studentIds)
      ? Array.from(new Set(body.studentIds.filter((v): v is string => typeof v === "string" && v.trim() !== "")))
      : [];
    if (ids.length === 0) return NextResponse.json({ error: "Select at least one student" }, { status: 400 });
    if (ids.length > MAX_STUDENTS) {
      return NextResponse.json({ error: `Select at most ${MAX_STUDENTS} students at a time` }, { status: 400 });
    }
    const unassign = body.unassign === true;
    const targetSectionId = typeof body.targetSectionId === "string" ? body.targetSectionId.trim() : "";
    if (unassign === !!targetSectionId) {
      return NextResponse.json({ error: "Give either a target section or unassign" }, { status: 400 });
    }
    const dryRun = body.dryRun === true;

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const [studentSnaps, deptsSnap, coursesSnap, targetSnap] = await Promise.all([
      db.getAll(...ids.map((id) => collegeRef.collection("students").doc(id))),
      collegeRef.collection("departments").get(),
      collegeRef.collection("courses").get(),
      targetSectionId ? collegeRef.collection("sections").doc(targetSectionId).get() : Promise.resolve(null),
    ]);
    const allDepts = deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DepartmentWithId[];
    const catalogByCourseId = new Map(coursesSnap.docs.map((c) => [c.id, (c.data() as { catalogId?: string }).catalogId]));

    let target: (Section & { id: string }) | null = null;
    if (targetSectionId) {
      if (!targetSnap?.exists) return NextResponse.json({ error: "Target section not found" }, { status: 404 });
      target = { id: targetSnap.id, ...(targetSnap.data() as object) } as Section & { id: string };
    }

    // HOD: only students AND a target section inside their own scope.
    const scope = session.role === "HOD" ? await getHodDepartmentScope(db, session.collegeId, session.uid) : null;
    const hodDepts = allDepts as unknown as DepartmentYearRow[];
    const inScope = (dept: string, year: number, catalogId?: string) =>
      !scope || canHodEditDepartmentYear(scope, hodDepts, dept, year, catalogId);
    if (scope && target && !inScope(target.department, target.year, catalogByCourseId.get(target.courseId ?? ""))) {
      return NextResponse.json({ error: "Outside your department" }, { status: 403 });
    }

    const structure = structureFromDepartments(allDepts);
    const isSharedDept = (name: string) =>
      structure.commonDepartment?.name === name || structure.subDepartments.some((sd) => sd.name === name);

    // Rolls already sitting in the target section (legacy data can still hold
    // a duplicate) - grows as students are accepted, so two picked students
    // with the same roll can't both land there.
    const targetRolls = new Set<string>();
    if (target) {
      const occupants = await collegeRef.collection("students")
        .where("department", "==", target.department)
        .where("courseId", "==", target.courseId)
        .where("section", "==", target.name)
        .where("year", "==", target.year)
        .get();
      for (const d of occupants.docs) {
        const r = String((d.data() as { rollNumber?: string }).rollNumber ?? "").trim().toLowerCase();
        if (r) targetRolls.add(r);
      }
    }

    const moves: MoveRow[] = [];
    const skipped: SkipRow[] = [];
    const writes: { ref: FirebaseFirestore.DocumentReference; update: Record<string, unknown>; historyDepartment: string; year: number; section: string; previous: string }[] = [];

    for (let i = 0; i < ids.length; i++) {
      const snap = studentSnaps[i];
      const id = ids[i];
      if (!snap.exists) { skipped.push({ id, name: id, reason: "Student not found" }); continue; }
      const student = snap.data() as StudentRecord;
      const label = { id, name: student.name };

      if (scope) {
        const catalogId = student.courseId
          ? catalogByCourseId.get(student.courseId)
          : await catalogFromCurrentSection(db, session.collegeId, student, catalogByCourseId);
        if (!inScope(student.department, student.year, catalogId)) {
          skipped.push({ ...label, reason: "Outside your department" });
          continue;
        }
      }

      const from = student.section ?? "";
      if (unassign) {
        if (!from) { skipped.push({ ...label, reason: "Already unassigned" }); continue; }
        moves.push({ id, name: student.name, rollNumber: student.rollNumber ?? "", from, to: "" });
        writes.push({ ref: snap.ref, update: { section: "", labBatch: "" }, historyDepartment: student.department, year: student.year, section: "", previous: from });
        continue;
      }

      const plan = planSectionMove(student, target!, { isSharedDept, targetRolls });
      if (!plan.ok) { skipped.push({ ...label, reason: plan.reason }); continue; }
      const roll = (student.rollNumber ?? "").trim().toLowerCase();
      if (roll) targetRolls.add(roll);
      moves.push({ id, name: student.name, rollNumber: student.rollNumber ?? "", from, to: target!.name });
      // A lab batch belongs to the section it was set in - never carried into another.
      writes.push({ ref: snap.ref, update: { ...plan.update, labBatch: "" }, historyDepartment: plan.historyDepartment, year: target!.year, section: target!.name, previous: from });
    }

    if (!dryRun && writes.length > 0) {
      const now = new Date();
      const batch = db.batch();
      for (const w of writes) {
        batch.update(w.ref, { ...w.update, updatedAt: now });
        const history = departmentHistoryEntry(db, session.collegeId, w.ref.id, w.historyDepartment, w.section, w.year, now, w.previous);
        batch.set(history.ref, history.data);
      }
      await batch.commit();
      const actor = await actorOf(db, session.collegeId, session.uid, session.email);
      await writeAuditLog(db, session.collegeId, {
        action: unassign ? "STUDENTS_BULK_UNASSIGNED" : "STUDENTS_BULK_MOVED",
        performedBy: session.uid,
        performedByName: actor.name,
        details: {
          count: moves.length,
          skipped: skipped.length,
          ...(target ? { toSectionId: target.id, toSection: target.name, toDepartment: target.department, toYear: target.year } : {}),
        },
      });
    }

    return NextResponse.json({
      dryRun,
      target: target ? { id: target.id, name: target.name } : null,
      moves,
      skipped,
      moved: dryRun ? 0 : moves.length,
    });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/bulk-move POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// A legacy student with no courseId yet: the programme their current section
// belongs to (same fallback the single PATCH uses for its HOD scope check).
async function catalogFromCurrentSection(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  student: StudentRecord,
  catalogByCourseId: Map<string, string | undefined>
): Promise<string | undefined> {
  if (!student.section) return undefined;
  const sectionDoc = await findCurrentSectionDoc(db, collegeId, student);
  const courseId = sectionDoc ? (sectionDoc.data() as { courseId?: string }).courseId : undefined;
  return courseId ? catalogByCourseId.get(courseId) : undefined;
}
