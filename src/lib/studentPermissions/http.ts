import { NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { ApprovalError } from "@/lib/approvals";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import type { SessionPayload } from "@/lib/auth/verifySession";
import { FACULTY_RAISER_ROLES, type ActingUser } from "./service";

// Shared plumbing for the permission routes, so each route file is only its own
// use-case: authenticate -> parse -> one service call -> respond.

export const STUDENT_ROLE = "STUDENT";
export const OVERSIGHT_ROLES = ["HOD", "VICE_PRINCIPAL", "PRINCIPAL"] as const;
export const ANY_PERMISSION_ROLE = [STUDENT_ROLE, ...FACULTY_RAISER_ROLES, "PRINCIPAL"] as const;

/** The acting login with its CURRENT roles (live-checked by requireRole) and display name. */
export async function actingUser(db: Firestore, session: SessionPayload & { collegeId: string }): Promise<ActingUser> {
  const snap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
  const name = (snap.data() as { name?: string } | undefined)?.name || session.email || session.uid;
  return { uid: session.uid, name, collegeId: session.collegeId, roles: session.roles?.length ? session.roles : [session.role] };
}

export async function authenticate(...roles: string[]) {
  return requireCollegeMember(...roles);
}

/** One place that turns anything thrown into the right HTTP response - never leaking internals. */
export function failure(err: unknown, tag: string) {
  if (err instanceof ApprovalError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.error(`[${tag}]`, err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

export async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { throw new ApprovalError("INVALID", "Invalid request body", 400); }
}

export const pageOptions = (url: URL) => {
  const limit = Number(url.searchParams.get("limit"));
  const before = url.searchParams.get("before") ?? undefined;
  return { limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 50, ...(before ? { before } : {}) };
};
