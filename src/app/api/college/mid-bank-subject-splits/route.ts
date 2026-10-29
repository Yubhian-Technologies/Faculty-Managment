export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { actorName, courseKeyForSubject, guardError, loadSubject, midBankRefs } from "@/lib/midBank/server";
import { cleanMidMap } from "@/lib/midBank/unitSplit";
import type { MidBankSubjectSplit } from "@/types";

// Exam Cell > Mid Configuration: one subject's own Mid units, used instead of
// the course rule (whatever the subject's unit count). Banks already started
// keep the units they started with.

const ROLES = ["EXAM_CELL", "SUPER_ADMIN"];
const col = (db: FirebaseFirestore.Firestore, collegeId: string) => midBankRefs(db, collegeId).college.collection("midBankSubjectSplits");

export async function GET() {
  try {
    const session = await requireCollegeMember(...ROLES);
    const snap = await col(getAdminDb(), session.collegeId).get();
    const splits = snap.docs.map((d) => d.data() as MidBankSubjectSplit).sort((a, b) => a.subjectCode.localeCompare(b.subjectCode));
    return NextResponse.json({ splits });
  } catch (err) {
    return guardError(err, "[college/mid-bank-subject-splits GET]");
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const body = (await readJsonBody(request)) as { subjectId?: string; mids?: unknown };
    const subjectId = String(body.subjectId ?? "");
    const db = getAdminDb();
    const subject = subjectId ? await loadSubject(db, session.collegeId, subjectId) : null;
    if (!subject) return NextResponse.json({ error: "Pick a subject" }, { status: 400 });
    const { value, error } = cleanMidMap(body.mids);
    if (error) return NextResponse.json({ error }, { status: 400 });
    if (Object.keys(value).length === 0) return NextResponse.json({ error: "Set the units for at least one Mid" }, { status: 400 });
    const data: MidBankSubjectSplit = {
      subjectId, subjectCode: subject.code, subjectName: subject.name,
      courseKey: await courseKeyForSubject(db, session.collegeId, subject), regulation: subject.regulation ?? "",
      mids: value, updatedBy: session.uid, updatedByName: await actorName(db, session.collegeId, session.uid),
      updatedAt: new Date() as unknown as MidBankSubjectSplit["updatedAt"],
    };
    await col(db, session.collegeId).doc(subjectId).set(data);
    return NextResponse.json({ split: data });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-bank-subject-splits PUT]");
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const subjectId = new URL(request.url).searchParams.get("subjectId") ?? "";
    if (!subjectId) return NextResponse.json({ error: "subjectId is required" }, { status: 400 });
    await col(getAdminDb(), session.collegeId).doc(subjectId).delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return guardError(err, "[college/mid-bank-subject-splits DELETE]");
  }
}
