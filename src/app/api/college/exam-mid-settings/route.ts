export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { ExamMidSettings } from "@/types";

// colleges/{collegeId}/examSettings/mid - single college-wide doc.
const READ_ROLES = ["EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"];

export async function GET() {
  try {
    const session = await requireCollegeMember(...READ_ROLES);
    const db = getAdminDb();
    const snap = await db
      .collection("colleges").doc(session.collegeId).collection("examSettings").doc("mid")
      .get();
    const settings: ExamMidSettings = snap.exists ? (snap.data() as ExamMidSettings) : { midCount: 0 };
    return NextResponse.json({ settings });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-mid-settings GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const body = (await readJsonBody(request)) as { midCount?: number };
    const midCount = Number(body.midCount);

    if (!Number.isInteger(midCount) || midCount < 1 || midCount > 10) {
      return NextResponse.json({ error: "Mid count must be an integer between 1 and 10" }, { status: 400 });
    }

    const db = getAdminDb();
    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Exam Cell";

    const settings: ExamMidSettings = {
      midCount,
      updatedAt: new Date() as unknown as ExamMidSettings["updatedAt"],
      updatedByName: actorName,
    };
    await db
      .collection("colleges").doc(session.collegeId).collection("examSettings").doc("mid")
      .set(settings, { merge: true });

    return NextResponse.json({ settings });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-mid-settings PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
