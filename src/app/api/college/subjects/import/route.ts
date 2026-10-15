export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { CURRICULUM_ROLES, subjectErrorResponse } from "@/lib/subjects/http";
import { SubjectMasterService } from "@/lib/subjects/services/SubjectMasterService";
import type { SubjectRowInput } from "@/lib/subjects/validation/SubjectValidator";

// Bulk-imports subjects into the master list of ONE Course (catalog) + Regulation. No department,
// year or semester here - assigning is the separate "Assign by code" step.
//
// All or nothing: every row is checked first (code unique inside the course + regulation, credits
// and L-T-P present, category defined - a repeated subject name is only a warning) and a single
// blocking problem anywhere means nothing is saved.
//   mode "validate" - dry run, writes nothing; 200 when clean, 422 with every problem otherwise.
//   mode "commit"   - saves everything in one transaction; 201, or 422 and nothing saved.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...CURRICULUM_ROLES);
    const body = (await readJsonBody(request)) as {
      mode?: "validate" | "commit";
      courseId?: string;
      regulation?: string;
      records?: SubjectRowInput[];
    };
    if (!body.courseId) return NextResponse.json({ error: "Select a course before importing." }, { status: 400 });
    if (!body.regulation?.trim()) return NextResponse.json({ error: "Select a regulation before importing." }, { status: 400 });
    if (!Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "No records provided." }, { status: 400 });
    }
    const dryRun = body.mode === "validate";
    const result = await new SubjectMasterService().importMany({
      collegeId: session.collegeId,
      courseId: body.courseId,
      regulation: body.regulation,
      records: body.records,
      dryRun,
      actor: { uid: session.uid, name: session.email },
    });
    const ok = result.failed.length === 0;
    const status = !ok ? 422 : dryRun ? 200 : 201;
    return NextResponse.json({ ...result, ok, mode: dryRun ? "validate" : "commit" }, { status });
  } catch (err) {
    return subjectErrorResponse(err, "[subjects/import]");
  }
}
