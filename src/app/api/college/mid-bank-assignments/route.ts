export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { loadMidSettings } from "@/lib/exams/midSettings";
import { notify } from "@/lib/notify";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { isDeadlineLocked } from "@/lib/midBank/deadline";
import { ALL_BRANCHES, assignmentIdFor, checkAssignment, isAllBranches, sectionsForScope } from "@/lib/midBank/assignments";
import { assignmentsCol, branchesOf, candidatesFor, hodMayAssign, loadAssignments, reviewDepartmentsForScope, startedByAssignment } from "@/lib/midBank/assignmentsServer";
import { actorName, guardError, loadDeadline, loginUidsOf, MID_BANK_OVERSEERS, midBankRefs, teachingFor } from "@/lib/midBank/server";
import { departmentNamesById, ownerDepartmentNames } from "@/lib/subjects/ownerDepartment";
import type { MidBankAssignment, MidBankDeadline, MidQuestionBank, Subject } from "@/types";

// "The HOD assigns" colleges: who prepares each subject's bank / papers for one deadline.
//   GET  ?deadlineId=   the subjects (HOD: those their department reviews; Exam Cell / leadership: all), per branch and
//                       for the whole subject: sections, teachers, the assignment, whether the caller may assign, the
//                       faculty who may be picked (teaching it there first, then the reviewing department's faculty).
//   POST { deadlineId, subjectId, scope: "BRANCH" | "SUBJECT", branch, facultyIds }  assign / reassign (HOD of the
//                       reviewing department; [] removes). A setter who already started can't be removed.

const VIEW_ROLES = ["HOD", ...MID_BANK_OVERSEERS];

async function load(db: FirebaseFirestore.Firestore, collegeId: string, d: MidBankDeadline, scope: Awaited<ReturnType<typeof getHodDepartmentScope>> | null, onlySubject?: string) {
  const [rows, assignments, bankSnap, names] = await Promise.all([
    teachingFor(db, collegeId, d),
    loadAssignments(db, collegeId, d.id),
    midBankRefs(db, collegeId).banks.where("deadlineId", "==", d.id).get(),
    departmentNamesById(db, collegeId),
  ]);
  const banks = bankSnap.docs.map((b) => b.data() as MidQuestionBank);
  const started = startedByAssignment(banks);
  const subjectIds = [...new Set(rows.map((r) => r.subjectId))].filter((s) => !onlySubject || s === onlySubject);
  const subjCol = midBankRefs(db, collegeId).college.collection("subjects");
  const subjects = new Map((subjectIds.length ? await db.getAll(...subjectIds.map((id) => subjCol.doc(id))) : []).filter((s) => s.exists).map((s) => [s.id, { ...(s.data() as Subject), id: s.id }]));
  const out = [];
  for (const subjectId of subjectIds) {
    const subject = subjects.get(subjectId);
    if (!subject) continue;
    const branches = branchesOf(rows, subjectId);
    const scopes = [...branches, ALL_BRANCHES];
    const items = [];
    for (const branch of scopes) {
      const depts = reviewDepartmentsForScope(rows, subject, branch, names);
      if (isAllBranches(branch) && depts.length === 0) { items.push(null); continue; }
      // Only the reviewing department's HOD assigns; the Exam Cell / leadership see it read-only.
      const canAssign = !!scope && hodMayAssign(scope, depts);
      items.push({ branch, depts, canAssign });
    }
    // HOD: only subjects they review somewhere.
    if (scope && !items.some((i) => i?.canAssign)) continue;
    const view = async (branch: string, depts: string[], canAssign: boolean) => {
      const a = assignments.find((x) => x.subjectId === subjectId && x.branch === branch) ?? null;
      const secs = sectionsForScope(rows, subjectId, branch);
      return {
        branch, reviewDepartments: depts, canAssign,
        sections: secs.map((s) => ({ sectionName: s.sectionName, branch: s.branch, facultyNames: s.facultyNames })),
        assignment: a && { ...a, started: [...(started.get(a.id) ?? [])] },
        candidates: canAssign ? await candidatesFor(db, collegeId, rows, subjectId, branch, depts) : [],
      };
    };
    const perBranch = [];
    for (let i = 0; i < branches.length; i++) { const it = items[i]!; perBranch.push(await view(it.branch, it.depts, it.canAssign)); }
    const w = items[branches.length];
    out.push({
      subjectId, subjectName: subject.name, subjectCode: subject.code, ownerDepartments: ownerDepartmentNames(subject, names),
      branches: perBranch,
      whole: w ? await view(ALL_BRANCHES, w.depts, w.canAssign) : null,
    });
  }
  return { rows, assignments, banks, out: out.sort((a, b) => a.subjectName.localeCompare(b.subjectName)) };
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...VIEW_ROLES);
    const db = getAdminDb();
    const d = await loadDeadline(db, session.collegeId, new URL(request.url).searchParams.get("deadlineId") ?? "");
    if (!d) return NextResponse.json({ error: "Deadline not found" }, { status: 404 });
    const settings = await loadMidSettings(db, session.collegeId);
    const scope = session.role === "HOD" ? await getHodDepartmentScope(db, session.collegeId, session.uid) : null;
    const { out } = await load(db, session.collegeId, d, scope);
    return NextResponse.json({ mode: settings.midAssignment, deadline: { ...d, locked: isDeadlineLocked(d.deadline) }, subjects: out });
  } catch (err) {
    return guardError(err, "[college/mid-bank-assignments GET]");
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD");
    const body = (await readJsonBody(request)) as { deadlineId?: string; subjectId?: string; scope?: string; branch?: string; facultyIds?: unknown };
    const db = getAdminDb();
    const settings = await loadMidSettings(db, session.collegeId);
    if (settings.midAssignment !== "HOD") return NextResponse.json({ error: "In this college faculty start their own - the Exam Cell can switch to \"The HOD assigns\" in Mid Configuration" }, { status: 409 });
    const d = await loadDeadline(db, session.collegeId, String(body.deadlineId ?? ""));
    if (!d) return NextResponse.json({ error: "Deadline not found" }, { status: 404 });
    if (isDeadlineLocked(d.deadline)) return NextResponse.json({ error: "The deadline has passed - ask the Exam Cell to extend it" }, { status: 403 });
    const scopeKind = body.scope === "SUBJECT" ? "SUBJECT" : "BRANCH";
    const branch = scopeKind === "SUBJECT" ? ALL_BRANCHES : String(body.branch ?? "");
    const subjectId = String(body.subjectId ?? "");
    const facultyIds = [...new Set(Array.isArray(body.facultyIds) ? body.facultyIds.map(String).filter(Boolean) : [])];

    const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
    const { out } = await load(db, session.collegeId, d, scope, subjectId);
    const subj = out[0];
    if (!subj) return NextResponse.json({ error: "Your department doesn't look after this subject" }, { status: 403 });
    const target = scopeKind === "SUBJECT" ? subj.whole : subj.branches.find((b) => b.branch === branch);
    if (!target) return NextResponse.json({ error: scopeKind === "SUBJECT" ? "One paper for all branches needs the subject's Subject Department set (Academics)" : "This subject isn't taught in that branch" }, { status: 400 });
    if (!target.canAssign) return NextResponse.json({ error: "Only the HOD of this subject's department can assign it" }, { status: 403 });

    const existing = [...subj.branches, ...(subj.whole ? [subj.whole] : [])].filter((x) => x.assignment && x.branch !== branch).map((x) => x.assignment!);
    const names = new Map(target.candidates.map((c) => [c.facultyId, c.name]));
    for (const n of target.assignment?.facultyIds ?? []) if (!names.has(n)) names.set(n, target.assignment!.facultyNames[target.assignment!.facultyIds.indexOf(n)] ?? "");
    const errors = checkAssignment({
      existing, scope: scopeKind, branch, facultyIds,
      candidateIds: new Set([...target.candidates.map((c) => c.facultyId), ...(target.assignment?.facultyIds ?? [])]),
      startedIds: new Set(target.assignment?.started ?? []), currentIds: target.assignment?.facultyIds ?? [], namesById: names,
    });
    if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 409 });

    const id = assignmentIdFor(d.id, subjectId, branch);
    const ref = assignmentsCol(db, session.collegeId).doc(id);
    const byName = (await actorName(db, session.collegeId, session.uid)) || session.email;
    const now = new Date().toISOString();
    const before = target.assignment?.facultyIds ?? [];
    if (facultyIds.length === 0) {
      await ref.delete();
    } else {
      const data: Omit<MidBankAssignment, "id"> = {
        deadlineId: d.id, subjectId, subjectName: subj.subjectName, subjectCode: subj.subjectCode, scope: scopeKind, branch,
        branches: scopeKind === "SUBJECT" ? [...new Set(subj.branches.map((b) => b.branch))] : [branch],
        facultyIds, facultyNames: facultyIds.map((f) => names.get(f) ?? ""),
        assignedByUid: session.uid, assignedByName: byName, at: now,
        history: [...(target.assignment?.history ?? []), { at: now, byName, facultyNames: facultyIds.map((f) => names.get(f) ?? "") }].slice(-20),
      };
      await ref.set(data);
    }
    await writeAuditLogSafe(db, session.collegeId, {
      action: "MID_BANK_ASSIGNED", performedBy: session.uid, performedByName: byName, targetId: id,
      details: { subject: `${subj.subjectName} (${subj.subjectCode})`, branch, setters: facultyIds.map((f) => names.get(f) ?? f) },
    });
    // Tell the newly assigned setters.
    const added = facultyIds.filter((f) => !before.includes(f));
    const uids = await loginUidsOf(db, session.collegeId, added);
    const what = settings.midPreparation === "PAPERS" ? "question papers" : "question bank";
    for (const f of added) {
      const uid = uids.get(f);
      if (uid) await notify(db, session.collegeId, uid, "MID_BANK_ASSIGNED", `Prepare the Mid ${d.midNumber} ${what}: ${subj.subjectName}`,
        `${byName} assigned you the ${subj.subjectName} (${subj.subjectCode}) ${what} for ${isAllBranches(branch) ? "all branches" : branch} - due ${d.deadline}.`, "/panel/mid-bank");
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-bank-assignments POST]");
  }
}
