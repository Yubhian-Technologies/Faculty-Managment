import { NextResponse } from "next/server";
import { badBodyResponse } from "@/lib/http/readJsonBody";
import { SubjectRequestError } from "@/lib/subjects/services/SubjectMasterService";

/** Roles that manage the curriculum (master subjects and their assignment). HODs only read it. */
export const CURRICULUM_ROLES = ["PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS"] as const;

/** One error mapping for every subject route: guard errors -> 401, SubjectRequestError -> its status, anything else -> logged 500. */
export function subjectErrorResponse(err: unknown, label: string): NextResponse {
  const badBody = badBodyResponse(err);
  if (badBody) return badBody;
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (err instanceof SubjectRequestError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(label, err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
