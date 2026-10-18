export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { getAdminDb } from "@/lib/firebase/admin";
import { authorizedSection } from "@/lib/students/sectionInchargeAuth";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import type { Section } from "@/types";
import { fetchSectionStudents } from "@/lib/students/sectionRoster";
import { MAX_CLASS_REPRESENTATIVES, classRepresentativeCountOf, validateRepresentativePicks } from "@/lib/sections/classRepresentatives";

// Class Representatives of one section. The HOD sets how many the section has (0-2); the section's faculty
// incharge (or the HOD) then picks that many students from the section's roster. Only a record on the Section -
// the Class Leader login is separate and untouched.
const ROLES = ["PANEL_MEMBER", "HOD"] as const;

export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const body = (await readJsonBody(request)) as { sectionId?: string; department?: string; count?: number; studentIds?: string[] };
    const { sectionId, department, count, studentIds } = body;

    // The HOD's department-wide setting: one number for every section of the department.
    if (department !== undefined) {
      if (session.role !== "HOD") return NextResponse.json({ error: "Only the HOD can set how many Class Representatives a department's sections have" }, { status: 403 });
      if (count === undefined || !Number.isInteger(count) || count < 0 || count > MAX_CLASS_REPRESENTATIVES) {
        return NextResponse.json({ error: `Number of Class Representatives must be 0 to ${MAX_CLASS_REPRESENTATIVES}` }, { status: 400 });
      }
      const db = getAdminDb();
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartment(scope, department)) return NextResponse.json({ error: "This department isn't yours" }, { status: 403 });
      const snap = await db.collection("colleges").doc(session.collegeId).collection("sections").where("department", "==", department).get();
      const batch = db.batch();
      const updated: { id: string; classRepresentatives: NonNullable<Section["classRepresentatives"]> }[] = [];
      for (const d of snap.docs) {
        const picks = ((d.data() as Section).classRepresentatives ?? []).slice(0, count);
        batch.update(d.ref, { classRepresentativeCount: count, classRepresentatives: picks, updatedAt: FieldValue.serverTimestamp() });
        updated.push({ id: d.id, classRepresentatives: picks });
      }
      if (updated.length > 0) await batch.commit();
      await writeAuditLogSafe(db, session.collegeId, {
        action: "SECTION_CLASS_REPS_SET",
        performedBy: session.uid,
        performedByName: session.email || session.role,
        targetId: department,
        details: { department, count, sections: updated.length },
      });
      return NextResponse.json({ success: true, classRepresentativeCount: count, sections: updated });
    }
    if (!sectionId) return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    if (count === undefined && studentIds === undefined) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });

    const auth = await authorizedSection(session, sectionId);
    if ("error" in auth) return auth.error;
    const { section } = auth;

    const updates: Record<string, unknown> = {};

    // How many CRs: HOD only.
    if (count !== undefined) {
      if (session.role !== "HOD") return NextResponse.json({ error: "Only the HOD can set how many Class Representatives a section has" }, { status: 403 });
      if (!Number.isInteger(count) || count < 0 || count > MAX_CLASS_REPRESENTATIVES) {
        return NextResponse.json({ error: `Number of Class Representatives must be 0 to ${MAX_CLASS_REPRESENTATIVES}` }, { status: 400 });
      }
      updates.classRepresentativeCount = count;
    }
    const effectiveCount = (updates.classRepresentativeCount as number | undefined) ?? classRepresentativeCountOf(section);

    const db = getAdminDb();
    const existing = section.classRepresentatives ?? [];
    let picks = studentIds !== undefined ? null : existing;
    if (studentIds !== undefined) {
      const problem = validateRepresentativePicks(studentIds, effectiveCount);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
      const roster = await fetchSectionStudents(db.collection("colleges").doc(session.collegeId), {
        department: section.department, sectionName: section.name, year: section.year, courseId: section.courseId,
      });
      const byId = new Map(roster.map((s) => [s.id, s]));
      const missing = studentIds.find((id) => !byId.has(id));
      if (missing) return NextResponse.json({ error: "Every Class Representative must be a student of this section" }, { status: 400 });
      picks = studentIds.map((id) => ({ studentId: id, name: byId.get(id)!.name, ...(byId.get(id)!.rollNumber ? { rollNumber: byId.get(id)!.rollNumber } : {}) }));
    } else if (existing.length > effectiveCount) {
      // The HOD lowered the number: keep the first picks that still fit.
      picks = existing.slice(0, effectiveCount);
    }
    if (picks !== existing) updates.classRepresentatives = picks;

    updates.updatedAt = FieldValue.serverTimestamp();
    await db.collection("colleges").doc(session.collegeId).collection("sections").doc(sectionId).update(updates);
    await writeAuditLogSafe(db, session.collegeId, {
      action: "SECTION_CLASS_REPS_SET",
      performedBy: session.uid,
      performedByName: session.email || session.role,
      targetId: sectionId,
      details: { count: effectiveCount, representatives: (picks ?? []).map((p) => p.name) },
    });
    return NextResponse.json({ success: true, classRepresentativeCount: effectiveCount, classRepresentatives: picks ?? [] });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[section-class-representatives PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
