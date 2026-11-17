import { NextResponse } from "next/server";
import { badBodyResponse } from "@/lib/http/readJsonBody";
import { COLLEGE_STAFF_UNIT_HEAD_ROLES } from "@/lib/attendance/collegeStaffUnits";
import { PasskeyError } from "@/lib/attendance/passkeys";

// Who checks in themselves (same list as face registration / check-in).
export const SELF_CHECK_IN_ROLES = ["PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_STAFF", ...COLLEGE_STAFF_UNIT_HEAD_ROLES];

export function passkeyErrorResponse(err: unknown, tag: string) {
  const bad = badBodyResponse(err);
  if (bad) return bad;
  if (err instanceof PasskeyError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
  }
  console.error(`[${tag}]`, err);
  return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
}
