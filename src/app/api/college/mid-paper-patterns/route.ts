export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { actorName, guardError, midBankRefs, rulesDocId } from "@/lib/midBank/server";
import { cleanPattern } from "@/lib/midPapers/pattern";
import { patternsCol } from "@/lib/midPapers/server";
import type { MidPaperPattern } from "@/types";

// Exam Cell > Mid Configuration > Question paper pattern (a college that prepares question papers): per course
// (+ regulation, or "ALL") - the parts, their kind and marks, which questions are answered, and how many
// question papers each faculty member submits. A paper set already started keeps the pattern it started with.

const ROLES = ["EXAM_CELL", "SUPER_ADMIN"];

export async function GET() {
  try {
    const session = await requireCollegeMember(...ROLES);
    const db = getAdminDb();
    const [snap, catalog] = await Promise.all([patternsCol(db, session.collegeId).get(), midBankRefs(db, session.collegeId).college.collection("courseCatalog").get()]);
    const regulationsByCourse: Record<string, string[]> = {};
    for (const d of catalog.docs) {
      const regs = (d.get("regulations") as string[] | undefined) ?? [];
      regulationsByCourse[d.id] = [...new Set(regs.map((r) => String(r).trim().toUpperCase()).filter(Boolean))].sort();
    }
    const patterns = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MidPaperPattern, "id">) }))
      .sort((a, b) => a.courseName.localeCompare(b.courseName) || a.regulation.localeCompare(b.regulation));
    return NextResponse.json({ patterns, regulationsByCourse });
  } catch (err) {
    return guardError(err, "[college/mid-paper-patterns GET]");
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const body = (await readJsonBody(request)) as Partial<MidPaperPattern>;
    const courseKey = String(body.courseKey ?? "").trim();
    const courseName = String(body.courseName ?? "").trim();
    const regulation = String(body.regulation ?? "").trim().toUpperCase() || "ALL";
    if (!courseKey || !courseName) return NextResponse.json({ error: "Select a course." }, { status: 400 });
    const { value, errors } = cleanPattern(body);
    if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 });
    const db = getAdminDb();
    if (regulation !== "ALL") {
      const cat = courseKey.startsWith("name:") ? null : await midBankRefs(db, session.collegeId).college.collection("courseCatalog").doc(courseKey).get();
      const regs = ((cat?.get("regulations") as string[] | undefined) ?? []).map((r) => String(r).trim().toUpperCase());
      if (!regs.includes(regulation)) return NextResponse.json({ error: `${regulation} is not a regulation of ${courseName} in Academics` }, { status: 400 });
    }
    const id = rulesDocId(courseKey, regulation);
    const data = { courseKey, courseName, regulation, ...value, updatedBy: session.uid, updatedByName: await actorName(db, session.collegeId, session.uid), updatedAt: new Date() };
    await patternsCol(db, session.collegeId).doc(id).set(data);
    return NextResponse.json({ pattern: { id, ...data } });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-paper-patterns PUT]");
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) return NextResponse.json({ error: "The record to update is missing. Reload the page and try again." }, { status: 400 });
    await patternsCol(getAdminDb(), session.collegeId).doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return guardError(err, "[college/mid-paper-patterns DELETE]");
  }
}
