export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { CourseStructureImportService } from "@/lib/subjects/services/CourseStructureImportService";
import type { SubjectRowInput } from "@/lib/subjects/validation/SubjectValidator";

// Backs Academics > Course Structure - one upload creates the master
// subjects AND assigns each into the selected department's semester (see
// CourseStructureImportService's own doc-comment). Supersedes
// subjects/import/route.ts (course+regulation-only, no department/semester
// routing), which Academics > Subjects (being removed) used.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS");
    const body = (await request.json()) as {
      courseId?: string;
      departmentId?: string;
      departmentName?: string;
      regulation?: string;
      academicYear?: string;
      records?: SubjectRowInput[];
    };

    if (!body.courseId) {
      return NextResponse.json({ error: "Select a course first" }, { status: 400 });
    }
    if (!body.departmentId) {
      return NextResponse.json({ error: "Select a department first" }, { status: 400 });
    }
    if (!body.records || !Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }
    if (body.records.length > 500) {
      return NextResponse.json({ error: "Maximum 500 records per import" }, { status: 400 });
    }

    const importer = new CourseStructureImportService();
    const result = await importer.executeImport({
      collegeId: session.collegeId,
      courseId: body.courseId,
      departmentId: body.departmentId,
      departmentName: body.departmentName,
      regulation: body.regulation,
      academicYear: body.academicYear,
      records: body.records,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/subjects/import-and-assign POST]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal error" }, { status: 500 });
  }
}
