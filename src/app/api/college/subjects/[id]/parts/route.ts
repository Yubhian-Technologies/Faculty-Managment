export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { CURRICULUM_ROLES, subjectErrorResponse } from "@/lib/subjects/http";
import { SubjectMasterService } from "@/lib/subjects/services/SubjectMasterService";
import { firstPartFor, isPartKey, partsOf } from "@/lib/subjects/parts";
import type { Subject } from "@/types";

// A subject taught in two parts by two departments (Academics; Principal / VP / Super Admin too).
//  GET   -> the parts, the frozen syllabus' unit count, and every section teaching it now with its order (which part
//           first) and each faculty row's part.
//  PUT   { parts: [{ name, units, departmentId } x2] | null }  - set the parts / stop teaching in parts.
//  PATCH { first: { sectionId: "A"|"B" }, assignmentParts: { assignmentId: "A"|"B"|null } } - the per-section plan.

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...CURRICULUM_ROLES);
    const { id } = await params;
    const college = getAdminDb().collection("colleges").doc(session.collegeId);
    const [snap, syllabusSnap, assignSnap] = await Promise.all([
      college.collection("subjects").doc(id).get(),
      college.collection("subjectSyllabus").doc(id).get(),
      college.collection("teachingAssignments").where("subjectId", "==", id).get(),
    ]);
    if (!snap.exists) return NextResponse.json({ error: "Subject not found. It may have been deleted." }, { status: 404 });
    const subject = { id: snap.id, ...(snap.data() as Omit<Subject, "id">) } as Subject;
    const syl = syllabusSnap.exists ? (syllabusSnap.data() as { status?: string; units?: unknown[] }) : null;

    type Row = { assignmentId: string; facultyName: string; department: string; part: "A" | "B" | null };
    const sections = new Map<string, { sectionId: string; sectionName: string; department: string; year: number | null; first: "A" | "B"; faculty: Row[] }>();
    for (const d of assignSnap.docs) {
      const a = d.data() as { isPast?: boolean; sectionId?: string; sectionName?: string; department?: string; year?: number; facultyName?: string; part?: unknown };
      if (a.isPast || !a.sectionId) continue;
      const s = sections.get(a.sectionId) ?? { sectionId: a.sectionId, sectionName: a.sectionName ?? "", department: a.department ?? "", year: a.year ?? null, first: firstPartFor(subject, a.sectionId), faculty: [] };
      s.faculty.push({ assignmentId: d.id, facultyName: a.facultyName ?? "", department: a.department ?? "", part: isPartKey(a.part) ? a.part : null });
      sections.set(a.sectionId, s);
    }
    const list = [...sections.values()].sort((x, y) => x.sectionName.localeCompare(y.sectionName, undefined, { numeric: true }));
    for (const s of list) s.faculty.sort((x, y) => x.facultyName.localeCompare(y.facultyName));

    return NextResponse.json({
      subject: { id: subject.id, name: subject.name, code: subject.code },
      parts: partsOf(subject),
      syllabusUnits: syl?.status === "FROZEN" && Array.isArray(syl.units) ? syl.units.length : null,
      sections: list,
    });
  } catch (err) {
    return subjectErrorResponse(err, "[subjects/[id]/parts GET]");
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...CURRICULUM_ROLES);
    const { id } = await params;
    const body = (await readJsonBody(request)) as { parts?: unknown };
    if (body.parts !== null && !Array.isArray(body.parts)) return NextResponse.json({ error: "Enter the two parts." }, { status: 400 });
    const result = await new SubjectMasterService().setParts({
      collegeId: session.collegeId, subjectId: id, parts: body.parts, actor: { uid: session.uid, name: session.email },
    });
    return NextResponse.json(result);
  } catch (err) {
    return subjectErrorResponse(err, "[subjects/[id]/parts PUT]");
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...CURRICULUM_ROLES);
    const { id } = await params;
    const body = (await readJsonBody(request)) as { first?: unknown; assignmentParts?: unknown };
    const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
    const result = await new SubjectMasterService().setPartPlan({
      collegeId: session.collegeId, subjectId: id, first: obj(body.first), assignmentParts: obj(body.assignmentParts),
      actor: { uid: session.uid, name: session.email },
    });
    return NextResponse.json(result);
  } catch (err) {
    return subjectErrorResponse(err, "[subjects/[id]/parts PATCH]");
  }
}
