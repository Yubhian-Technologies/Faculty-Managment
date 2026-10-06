export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { getAdminDb } from "@/lib/firebase/admin";
import { authorizedSection } from "@/lib/students/sectionInchargeAuth";
import { fetchSectionStudents } from "@/lib/students/sectionRoster";
import { normalizeBatch } from "@/lib/students/labBatchMode";

// Saves the lab batches of a section ("Batch 1", "Batch 2", ...) BEFORE students
// are divided into them: the faculty incharge first sets how many batches there
// are and saves, then moves students. See Section.labBatches.
const MAX_BATCHES = 20;
const MAX_LABEL = 40;

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    const body = (await readJsonBody(request)) as { sectionId?: string; labBatches?: unknown };
    const sectionId = body.sectionId?.trim();
    if (!sectionId) return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    if (!Array.isArray(body.labBatches)) return NextResponse.json({ error: "labBatches must be a list of names" }, { status: 400 });
    if (body.labBatches.length > MAX_BATCHES) return NextResponse.json({ error: `At most ${MAX_BATCHES} batches` }, { status: 400 });

    const labels: string[] = [];
    const seen = new Set<string>();
    for (const raw of body.labBatches) {
      const label = typeof raw === "string" ? raw.trim() : "";
      if (!label) return NextResponse.json({ error: "A batch name cannot be empty" }, { status: 400 });
      if (label.length > MAX_LABEL) return NextResponse.json({ error: `A batch name can be at most ${MAX_LABEL} characters` }, { status: 400 });
      if (seen.has(normalizeBatch(label))) return NextResponse.json({ error: `"${label}" is listed twice` }, { status: 400 });
      seen.add(normalizeBatch(label));
      labels.push(label);
    }

    const auth = await authorizedSection(session, sectionId);
    if ("error" in auth) return auth.error;
    const { section } = auth;

    // A batch some student is still in cannot be dropped from the list - move them out first.
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const students = await fetchSectionStudents(collegeRef, {
      department: section.department, sectionName: section.name, year: section.year, courseId: section.courseId,
    });
    const inUse = new Map<string, number>();
    for (const s of students) {
      const key = normalizeBatch(s.labBatch);
      if (key) inUse.set(key, (inUse.get(key) ?? 0) + 1);
    }
    const missing = Array.from(inUse.keys()).filter((k) => !seen.has(k));
    if (missing.length > 0) {
      const name = students.find((s) => normalizeBatch(s.labBatch) === missing[0])?.labBatch ?? missing[0];
      return NextResponse.json({ error: `Students are still in ${name} - move them out of it before removing it` }, { status: 409 });
    }

    await collegeRef.collection("sections").doc(sectionId).update({ labBatches: labels, updatedAt: new Date() });
    await writeAuditLogSafe(db, session.collegeId, {
      action: "SECTION_LAB_BATCHES_SET",
      performedBy: session.uid,
      performedByName: session.email || session.role,
      targetId: sectionId,
      details: { sectionName: section.name, year: section.year, labBatches: labels },
    });
    return NextResponse.json({ ok: true, labBatches: labels });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/section-lab-batches PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
