export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import {
  CourseStructureConflictError,
  CourseStructureImportService,
  CourseStructureRequestError,
} from "@/lib/subjects/services/CourseStructureImportService";
import { COURSE_STRUCTURE_MAX_ROWS } from "@/lib/subjects/courseStructureValidation";

// Backs Academics > Course Structure - one file of subjects for one
// Regulation + Course + Department, created as master subjects and assigned
// to that department's semesters in a single all-or-nothing commit (see
// CourseStructureImportService's own doc-comment).
//
//   GET  ?courseId&departmentId&regulation  -> the department's scope
//        (years taught, semesters per year, what's already assigned)
//   POST { mode: "validate" | "commit", ... } -> dry run / atomic import

const ROLES = ["PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS"] as const;

const cell = z.union([z.string(), z.number(), z.null()]).optional();
const bodySchema = z.object({
  mode: z.enum(["validate", "commit"]),
  courseId: z.string().min(1, "Select a course first"),
  departmentId: z.string().min(1, "Select a department first"),
  regulation: z.string().trim().min(1, "Select a regulation first"),
  records: z
    .array(z.object({ rowNumber: z.number().int().positive(), data: z.record(z.string(), cell) }))
    .min(1, "No records provided")
    .max(COURSE_STRUCTURE_MAX_ROWS, `Maximum ${COURSE_STRUCTURE_MAX_ROWS} rows per import`),
});

function handleError(err: unknown, label: string) {
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (err instanceof CourseStructureRequestError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof CourseStructureConflictError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  console.error(label, err);
  return NextResponse.json({ error: "Internal error - nothing was saved." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get("courseId");
    const departmentId = searchParams.get("departmentId");
    const regulation = searchParams.get("regulation")?.trim();
    if (!courseId || !departmentId || !regulation) {
      return NextResponse.json({ error: "courseId, departmentId and regulation are required" }, { status: 400 });
    }
    const summary = await new CourseStructureImportService().getScope(session.collegeId, courseId, departmentId, regulation);
    return NextResponse.json(summary);
  } catch (err) {
    return handleError(err, "[college/subjects/import-and-assign GET]");
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    }
    const { mode, courseId, departmentId, regulation, records } = parsed.data;

    const result = await new CourseStructureImportService().run(
      { collegeId: session.collegeId, courseId, departmentId, regulation, records },
      mode
    );
    // 422: the file has problems and nothing was written. 201: committed.
    const status = !result.ok ? 422 : mode === "commit" ? 201 : 200;
    return NextResponse.json(result, { status });
  } catch (err) {
    return handleError(err, "[college/subjects/import-and-assign POST]");
  }
}
