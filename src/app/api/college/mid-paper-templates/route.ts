export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { actorName, guardError, midBankRefs, rulesDocId } from "@/lib/midBank/server";
import { cleanTemplate } from "@/lib/midPaper/rules";
import type { MidPaperTemplate } from "@/types";

// Exam Cell > Mid Configuration > Question paper: the Mid question paper
// template per course (+ regulation, or "ALL") - the level sequence for each
// level Question 1 may start at, the unit of each question, the instruction line.

const ROLES = ["EXAM_CELL", "SUPER_ADMIN"];
const col = (db: FirebaseFirestore.Firestore, collegeId: string) => midBankRefs(db, collegeId).college.collection("midPaperTemplates");

export async function GET() {
  try {
    const session = await requireCollegeMember(...ROLES);
    const db = getAdminDb();
    const [snap, catalog] = await Promise.all([col(db, session.collegeId).get(), midBankRefs(db, session.collegeId).college.collection("courseCatalog").get()]);
    const regulationsByCourse: Record<string, string[]> = {};
    for (const d of catalog.docs) {
      const regs = (d.get("regulations") as string[] | undefined) ?? [];
      regulationsByCourse[d.id] = [...new Set(regs.map((r) => String(r).trim().toUpperCase()).filter(Boolean))].sort();
    }
    const templates = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MidPaperTemplate, "id">) }))
      .sort((a, b) => a.courseName.localeCompare(b.courseName) || a.regulation.localeCompare(b.regulation));
    return NextResponse.json({ templates, regulationsByCourse });
  } catch (err) {
    return guardError(err, "[college/mid-paper-templates GET]");
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const body = (await readJsonBody(request)) as Partial<MidPaperTemplate>;
    const courseKey = String(body.courseKey ?? "").trim();
    const courseName = String(body.courseName ?? "").trim();
    const regulation = String(body.regulation ?? "").trim().toUpperCase() || "ALL";
    if (!courseKey || !courseName) return NextResponse.json({ error: "Pick a course" }, { status: 400 });
    const { value, errors } = cleanTemplate(body);
    if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 });
    const db = getAdminDb();
    if (regulation !== "ALL") {
      const cat = courseKey.startsWith("name:") ? null : await midBankRefs(db, session.collegeId).college.collection("courseCatalog").doc(courseKey).get();
      const regs = ((cat?.get("regulations") as string[] | undefined) ?? []).map((r) => String(r).trim().toUpperCase());
      if (!regs.includes(regulation)) return NextResponse.json({ error: `${regulation} is not a regulation of ${courseName} in Academics` }, { status: 400 });
    }
    const id = rulesDocId(courseKey, regulation);
    const data = { courseKey, courseName, regulation, ...value, updatedBy: session.uid, updatedByName: await actorName(db, session.collegeId, session.uid), updatedAt: new Date() };
    await col(db, session.collegeId).doc(id).set(data);
    return NextResponse.json({ template: { id, ...data } });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-paper-templates PUT]");
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    await col(getAdminDb(), session.collegeId).doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return guardError(err, "[college/mid-paper-templates DELETE]");
  }
}
