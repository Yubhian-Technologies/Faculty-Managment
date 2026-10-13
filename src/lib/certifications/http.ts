import { NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import type { SessionPayload } from "@/lib/auth/verifySession";
import { CertificationError } from "./types";
import type { ActingUser } from "./types";
import { CertificateStateConflictError } from "./transitions";

// Shared plumbing for the certificate-requests routes: authenticate -> parse
// -> one service call -> respond. Mirrors src/lib/studentPermissions/http.ts.

export async function actingUser(db: Firestore, session: SessionPayload & { collegeId: string }): Promise<ActingUser> {
  const snap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
  const name = (snap.data() as { name?: string } | undefined)?.name || session.email || session.uid;
  return { uid: session.uid, name, collegeId: session.collegeId, role: session.role };
}

export async function authenticate(...roles: string[]) {
  return requireCollegeMember(...roles);
}

/** One place that turns anything thrown into the right HTTP response - never leaking internals. */
export function failure(err: unknown, tag: string) {
  if (err instanceof CertificationError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  if (err instanceof CertificateStateConflictError) return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.error(`[${tag}]`, err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

export async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { throw new CertificationError("INVALID", "Invalid request body", 400); }
}

// Every college role that could conceivably be the resolved recipient of a
// step/branch/issuer - since a step's actual recipient set is config-defined
// (HOD by department-scope, or any college role), the route guard can only
// prove "is a college member"; decisionRules.canDecide proves "is THIS step's
// recipient". Mirrors the same broad list src/app/api/leave/applications/
// route.ts already uses for the identical reason.
export const ANY_CERTIFICATE_ACTOR_ROLE = [
  "STUDENT", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE", "COLLEGE_STAFF",
  "ACADEMICS", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "LIBRARY", "HOSTEL", "PD", "EXAM_CELL",
  "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT",
] as const;
