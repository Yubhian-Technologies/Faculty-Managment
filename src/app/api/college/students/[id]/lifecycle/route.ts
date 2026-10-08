export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { canHodEditDepartmentYear, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import { departmentHistoryEntry } from "@/lib/students/departmentHistory";
import { setStudentLoginActive } from "@/lib/students/provisionLogin";
import { invalidateSectionCountCache } from "@/lib/students/sectionCounts";
import { planDetain, planPlacement } from "@/lib/students/lifecycle";
import { actorOf } from "@/lib/audit/actorOf";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import type { Section, StudentRecord } from "@/types";

// A student who is held back a year (DETAIN: only flagged - nothing moves; PLACE: later, once the
// junior batch's sections exist, put into a section of the SAME year in a junior batch),
// leaves the college (DISCONTINUE: record and history kept, but in no class from then on), or is
// taken back (REINSTATE: Principal / Vice Principal only). Whoever may change a student's
// roster status may do the first two; an HOD only inside their own department.

type Action = "DETAIN" | "PLACE" | "DISCONTINUE" | "REINSTATE";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE");
    const { id } = await params;
    const body = (await readJsonBody(request)) as { action?: Action; targetSectionId?: string; reason?: string };
    const action = body.action;
    if (action !== "DETAIN" && action !== "PLACE" && action !== "DISCONTINUE" && action !== "REINSTATE") {
      return NextResponse.json({ error: "action must be DETAIN, PLACE, DISCONTINUE or REINSTATE" }, { status: 400 });
    }
    if (action === "REINSTATE" && !["PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"].includes(session.role)) {
      return NextResponse.json({ error: "Only the Principal can reinstate a discontinued student" }, { status: 403 });
    }
    const reason = (body.reason ?? "").trim().slice(0, 500);

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const studentRef = collegeRef.collection("students").doc(id);
    const studentSnap = await studentRef.get();
    if (!studentSnap.exists) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    const student = studentSnap.data() as StudentRecord;

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      let allowed = false;
      if (scope?.departmentName) {
        const deptsSnap = await collegeRef.collection("departments").get();
        const all = deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DepartmentYearRow[];
        allowed = canHodEditDepartmentYear(scope, all, student.department, student.year);
      }
      if (!allowed) return NextResponse.json({ error: "Outside your department" }, { status: 403 });
    }

    const now = new Date();
    const batch = db.batch();
    let auditAction: string;
    let details: Record<string, unknown>;
    let loginActive: boolean | null = null;

    if (action === "DETAIN") {
      const plan = planDetain(student, { now, reason });
      if (!plan.ok) return NextResponse.json({ error: plan.reason }, { status: 400 });
      batch.update(studentRef, plan.update);
      auditAction = "STUDENT_DETAINED";
      details = { year: student.year, section: student.section || "", reason };
    } else if (action === "PLACE") {
      if (!body.targetSectionId) return NextResponse.json({ error: "Pick the section the student will repeat the year in" }, { status: 400 });
      const targetSnap = await collegeRef.collection("sections").doc(body.targetSectionId).get();
      if (!targetSnap.exists) return NextResponse.json({ error: "Target section not found" }, { status: 404 });
      const target = { id: targetSnap.id, ...(targetSnap.data() as object) } as Section;
      const courseIds = [student.courseId, target.courseId].filter((c): c is string => !!c);
      const catalogs = new Map<string, string | undefined>();
      for (const c of new Set(courseIds)) {
        const cs = await collegeRef.collection("courses").doc(c).get();
        catalogs.set(c, (cs.data() as { catalogId?: string } | undefined)?.catalogId);
      }
      const plan = planPlacement(student, target, {
        studentCatalogId: student.courseId ? catalogs.get(student.courseId) : undefined,
        targetCatalogId: target.courseId ? catalogs.get(target.courseId) : undefined,
        now,
      });
      if (!plan.ok) return NextResponse.json({ error: plan.reason }, { status: 400 });
      if (student.rollNumber) {
        const dup = await collegeRef.collection("students")
          .where("rollNumber", "==", student.rollNumber)
          .where("department", "==", target.department)
          .where("courseId", "==", target.courseId ?? "")
          .where("section", "==", target.name)
          .where("year", "==", target.year)
          .get();
        if (dup.docs.some((d) => d.id !== id)) {
          return NextResponse.json({ error: "Roll number already exists in the target section" }, { status: 400 });
        }
      }
      batch.update(studentRef, plan.update);
      const history = departmentHistoryEntry(db, session.collegeId, id, target.department, target.name, target.year, now, student.section || "");
      batch.set(history.ref, history.data);
      auditAction = "STUDENT_DETAINED_PLACED";
      details = { year: target.year, fromSection: student.section || "", toSection: target.name, toBatch: target.batch ?? "" };
    } else if (action === "DISCONTINUE") {
      if (student.status === "DISCONTINUED") return NextResponse.json({ error: "Already discontinued" }, { status: 400 });
      if (student.status === "GRADUATED") return NextResponse.json({ error: "A graduated student can't be discontinued" }, { status: 400 });
      batch.update(studentRef, {
        status: "DISCONTINUED",
        discontinuedAt: now,
        discontinuedReason: reason,
        // Where they were, kept so the record (and a reinstatement) still knows.
        discontinuedFrom: {
          department: student.department, secondaryDepartment: student.secondaryDepartment ?? null,
          section: student.section || "", year: student.year, courseId: student.courseId ?? null, labBatch: student.labBatch ?? "",
        },
        // Out of every class: rosters are built from section membership.
        section: "",
        labBatch: "",
        updatedAt: now,
      });
      const history = departmentHistoryEntry(db, session.collegeId, id, student.department, "", student.year, now, student.section || "");
      batch.set(history.ref, history.data);
      loginActive = false;
      auditAction = "STUDENT_DISCONTINUED";
      details = { fromYear: student.year, fromSection: student.section || "", reason };
    } else {
      if (student.status !== "DISCONTINUED") return NextResponse.json({ error: "Only a discontinued student can be reinstated" }, { status: 400 });
      const from = student.discontinuedFrom;
      batch.update(studentRef, {
        status: "REGULAR",
        reinstatedAt: now,
        // Back on the rolls but not in a class: the HOD/office places them again.
        ...(from?.department ? { department: from.department } : {}),
        ...(from?.year ? { year: from.year } : {}),
        ...(from?.courseId ? { courseId: from.courseId } : {}),
        secondaryDepartment: from?.secondaryDepartment ?? null,
        updatedAt: now,
      });
      loginActive = true;
      auditAction = "STUDENT_REINSTATED";
      details = { reason };
    }

    await batch.commit();
    invalidateSectionCountCache(session.collegeId);

    let loginWarning: string | undefined;
    if (loginActive !== null && student.uid) {
      try {
        await setStudentLoginActive(db, await getAdminAuth(), session.collegeId, student.uid, loginActive);
      } catch (err) {
        console.error("[college/students/[id]/lifecycle] login update failed", err);
        loginWarning = "The student was updated but their login could not be switched - try again.";
      }
    }

    const actor = await actorOf(db, session.collegeId, session.uid, session.email);
    await writeAuditLog(db, session.collegeId, {
      action: auditAction,
      performedBy: session.uid,
      performedByName: actor.name,
      targetId: id,
      details: { name: student.name, rollNumber: student.rollNumber, ...details },
    });

    return NextResponse.json({ ok: true, ...(loginWarning ? { warning: loginWarning } : {}) });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/[id]/lifecycle POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
