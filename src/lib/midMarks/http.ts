import { NextResponse } from "next/server";
import { badBodyResponse } from "@/lib/http/readJsonBody";
import { MidMarksError } from "./sheet";

export function midMarksErrorResponse(err: unknown, tag: string) {
  const bad = badBodyResponse(err);
  if (bad) return bad;
  if (err instanceof MidMarksError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
  }
  console.error(tag, err);
  return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
}
