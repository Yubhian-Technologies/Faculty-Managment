export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { MasterSubjectImportService } from "@/lib/subjects/services/MasterSubjectImportService";
import type { SubjectRowInput } from "@/lib/subjects/validation/SubjectValidator";

// Bulk-imports subjects straight into the master collection, scoped only by
// Course + Regulation - no department/year/semester here (that stays a
// separate step: Assign to Semester, or the single Add Subject dialog's own
// semester half). MasterSubjectImportService already supported exactly
// this; nothing in the app called it until now.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS");
    const body = (await readJsonBody(request)) as {
      courseId?: string;
      regulation?: string;
      academicYear?: string;
      records?: SubjectRowInput[];
    };
    if (!body.courseId) {
      return NextResponse.json({ error: "Select a Course before importing" }, { status: 400 });
    }
    if (!Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }
    if (body.records.length > 500) {
      return NextResponse.json({ error: "Maximum 500 records per import" }, { status: 400 });
    }

    const service = new MasterSubjectImportService();
    const result = await service.executeImport({
      collegeId: session.collegeId,
      courseId: body.courseId,
      academicYear: body.academicYear?.trim() || undefined,
      regulation: body.regulation?.trim() || undefined,
      records: body.records,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[subjects/import]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
