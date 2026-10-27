export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { canHodEditDepartment, getHodDepartmentScope } from "@/lib/departments/scope";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { cleanOutcomes, outcomeConflicts } from "@/lib/midBank/outcomes";
import { actorName, guardError, loadOutcomes, MID_BANK_READ_ROLES, midBankRefs, usedOutcomeRefs } from "@/lib/midBank/server";
import type { Subject, SubjectOutcomes } from "@/types";

// A subject's units, Course Outcomes, PSOs and CO -> PO/PSO mapping, entered
// once in the Mid Question Bank setup and shared by both Mids.
//  - the faculty assigned a Mid of the subject may enter them, and edit them
//    while no question uses them yet;
//  - after that only the subject's HOD may edit, and never so that a unit or
//    CO a question uses disappears.

type Params = { params: Promise<{ subjectId: string }> };

async function who(db: FirebaseFirestore.Firestore, session: { uid: string; role: string; collegeId: string }, subject: Subject) {
  const facultyId = await resolveFacultyMemberId(db, session.collegeId, session.uid);
  const held = await midBankRefs(db, session.collegeId).assignments.where("subjectId", "==", subject.id).where("facultyId", "==", facultyId).limit(1).get();
  let isHod = false;
  if (session.role === "HOD") isHod = canHodEditDepartment(await getHodDepartmentScope(db, session.collegeId, session.uid), subject.department ?? "");
  const leadership = ["PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"].includes(session.role);
  return { isHolder: !held.empty, isHod, canRead: !held.empty || isHod || leadership };
}

async function loadSubject(db: FirebaseFirestore.Firestore, collegeId: string, subjectId: string): Promise<Subject | null> {
  const s = await midBankRefs(db, collegeId).college.collection("subjects").doc(subjectId).get();
  return s.exists ? ({ id: s.id, ...(s.data() as Omit<Subject, "id">) }) : null;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_BANK_READ_ROLES);
    const { subjectId } = await params;
    const db = getAdminDb();
    const subject = await loadSubject(db, session.collegeId, subjectId);
    if (!subject) return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    const access = await who(db, session, subject);
    if (!access.canRead) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ outcomes: await loadOutcomes(db, session.collegeId, subjectId) });
  } catch (err) {
    return guardError(err, "[college/subject-outcomes GET]");
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    const { subjectId } = await params;
    const body = (await readJsonBody(request)) as { baseVersion?: number } & Record<string, unknown>;
    const db = getAdminDb();
    const subject = await loadSubject(db, session.collegeId, subjectId);
    if (!subject) return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    const access = await who(db, session, subject);
    if (!access.isHolder && !access.isHod) {
      return NextResponse.json({ error: "Only the faculty assigned this subject's Mid question bank, or its HOD, can set this up" }, { status: 403 });
    }

    const { value, errors } = cleanOutcomes(body);
    if (errors.length > 0) return NextResponse.json({ error: errors[0], errors }, { status: 400 });

    const used = await usedOutcomeRefs(db, session.collegeId, subjectId);
    const inUse = used.units.size > 0 || used.cos.size > 0;
    if (inUse && !access.isHod) {
      return NextResponse.json({ error: "Questions already use this setup - ask your HOD to change it" }, { status: 403 });
    }
    const conflicts = outcomeConflicts(value, used);
    if (conflicts.length > 0) return NextResponse.json({ error: conflicts[0], errors: conflicts }, { status: 409 });

    const name = await actorName(db, session.collegeId, session.uid);
    const ref = midBankRefs(db, session.collegeId).outcomes.doc(subjectId);
    const saved = await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      const current = cur.exists ? (cur.data() as SubjectOutcomes) : null;
      if ((current?.version ?? 0) !== Number(body.baseVersion ?? 0)) return null;
      const now = new Date();
      const data = {
        subjectId, subjectName: subject.name, subjectCode: subject.code, ...value,
        version: (current?.version ?? 0) + 1, updatedBy: session.uid, updatedByName: name, updatedAt: now,
        createdAt: current?.createdAt ?? now,
      };
      tx.set(ref, data);
      return data;
    });
    if (!saved) return NextResponse.json({ error: "Someone else saved this setup meanwhile - reload to see their version" }, { status: 409 });
    return NextResponse.json({ outcomes: saved });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/subject-outcomes PUT]");
  }
}
