export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { ExamConfigComponent, ExamConfiguration } from "@/types";

// Broad read access — same role set already used for /api/college/subjects —
// so the Exam Cell dashboard, Principal/HOD oversight, and the Faculty
// Dashboard's Internal Exam module (which needs to read a subject's config
// live) can all fetch this.
const READ_ROLES = ["EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "PANEL_MEMBER"];

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...READ_ROLES);
    const { searchParams } = new URL(request.url);
    const subjectId = searchParams.get("subjectId");
    const courseId = searchParams.get("courseId");
    const year = searchParams.get("year");

    const db = getAdminDb();
    const coll = db.collection("colleges").doc(session.collegeId).collection("examConfigurations");

    if (subjectId) {
      const snap = await coll.doc(subjectId).get();
      return NextResponse.json({ configuration: snap.exists ? { id: snap.id, ...snap.data() } : null });
    }

    let query: FirebaseFirestore.Query = coll;
    if (courseId) query = query.where("courseId", "==", courseId);
    if (year) query = query.where("year", "==", Number(year));

    const snap = await query.get();
    const configurations = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((a as { subjectName?: string }).subjectName ?? "").localeCompare((b as { subjectName?: string }).subjectName ?? ""));

    return NextResponse.json({ configurations });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-configurations GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Upsert — the document id is always the subjectId (one configuration per
// subject), so re-saving the same subject edits its existing configuration
// instead of creating a duplicate.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      courseId?: string;
      courseName?: string;
      department?: string;
      year?: number;
      subjectId?: string;
      subjectName?: string;
      subjectCode?: string;
      internalMaxMarks?: number;
      externalMaxMarks?: number;
      components?: (Omit<ExamConfigComponent, "id"> & { id?: string })[];
      status?: "ACTIVE" | "INACTIVE";
    };

    const {
      courseId, courseName, department, year, subjectId, subjectName, subjectCode,
      internalMaxMarks, externalMaxMarks, components, status,
    } = body;

    if (!courseId || !department || !year || !subjectId || !subjectName) {
      return NextResponse.json({ error: "courseId, department, year, subjectId and subjectName are required" }, { status: 400 });
    }
    if (typeof internalMaxMarks !== "number" || internalMaxMarks <= 0) {
      return NextResponse.json({ error: "Internal Maximum Marks must be a positive number" }, { status: 400 });
    }
    if (typeof externalMaxMarks !== "number" || externalMaxMarks < 0) {
      return NextResponse.json({ error: "External Maximum Marks must be a non-negative number" }, { status: 400 });
    }
    if (!Array.isArray(components) || components.length === 0) {
      return NextResponse.json({ error: "At least one internal marks component is required" }, { status: 400 });
    }
    for (const c of components) {
      if (!c.name?.trim()) {
        return NextResponse.json({ error: "Every component needs a name" }, { status: 400 });
      }
      if (typeof c.maxMarks !== "number" || c.maxMarks <= 0) {
        return NextResponse.json({ error: `"${c.name}" needs a positive maximum marks value` }, { status: 400 });
      }
    }
    const activeTotal = components.filter((c) => c.isActive !== false).reduce((sum, c) => sum + c.maxMarks, 0);
    if (activeTotal !== internalMaxMarks) {
      return NextResponse.json(
        { error: `Breakdown total must equal the Internal Maximum Marks (${internalMaxMarks}). Current total: ${activeTotal}.` },
        { status: 400 }
      );
    }

    const db = getAdminDb();

    // requireCollegeMember only decodes the session cookie (uid/role/collegeId) —
    // the actor's display name lives in their Firestore user record.
    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Exam Cell";

    const ref = db.collection("colleges").doc(session.collegeId).collection("examConfigurations").doc(subjectId);
    const existingSnap = await ref.get();
    const existing = existingSnap.exists ? (existingSnap.data() as ExamConfiguration) : null;
    const now = new Date();

    const normalizedComponents: ExamConfigComponent[] = components.map((c, i) => ({
      id: c.id || `c${i}_${Date.now().toString(36)}`,
      name: c.name.trim(),
      maxMarks: c.maxMarks,
      ...(c.description?.trim() ? { description: c.description.trim() } : {}),
      order: c.order ?? i,
      isActive: c.isActive !== false,
    }));

    // Written via .set() with a plain object (not typed against ExamConfiguration)
    // since createdAt/updatedAt are a native Date here — the Admin SDK converts
    // it to a Firestore Timestamp on write, matching every other route's convention.
    const data = {
      collegeId: session.collegeId,
      courseId,
      courseName: courseName ?? "",
      department,
      year,
      subjectId,
      subjectName,
      subjectCode: subjectCode ?? "",
      internalMaxMarks,
      externalMaxMarks,
      components: normalizedComponents,
      status: status ?? "ACTIVE",
      createdBy: existing?.createdBy ?? session.uid,
      createdByName: existing?.createdByName ?? actorName,
      updatedBy: session.uid,
      updatedByName: actorName,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await ref.set(data);

    return NextResponse.json({ configuration: { id: subjectId, ...data } }, { status: existing ? 200 : 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-configurations POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
