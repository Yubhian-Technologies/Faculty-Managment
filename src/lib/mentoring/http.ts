import { NextResponse } from "next/server";
import { badBodyResponse } from "@/lib/http/readJsonBody";

/** The shared catch-block answer of the mentoring routes: bad body / guard sentinels / 500. */
export function mentoringErrorResponse(err: unknown, tag: string): NextResponse {
  const badBody = badBodyResponse(err);
  if (badBody) return badBody;
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.error(tag, err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
