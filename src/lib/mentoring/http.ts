import { NextResponse } from "next/server";
import { badBodyResponse } from "@/lib/http/readJsonBody";

/** The shared catch-block answer of the mentoring routes: bad body / guard sentinels / 500. */
export function mentoringErrorResponse(err: unknown, tag: string): NextResponse {
  const badBody = badBodyResponse(err);
  if (badBody) return badBody;
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
  }
  console.error(tag, err);
  return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
}
