import { NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { badBodyResponse } from "@/lib/http/readJsonBody";
import { getHodDepartmentScope, editableDepartmentNames } from "@/lib/departments/scope";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { AdjustmentError } from "./server";

// Shared by the class-adjustments routes: who the caller is (faculty record, HOD departments, name) and the error shape.

export interface Caller { uid: string; name: string; facultyId: string; hodDepartments: string[] }

export async function callerOf(db: Firestore, session: { uid: string; role: string; collegeId: string }): Promise<Caller> {
  const c = session.collegeId;
  const [facultyId, userSnap, hodDepartments] = await Promise.all([
    resolveFacultyMemberId(db, c, session.uid),
    db.collection("colleges").doc(c).collection("users").doc(session.uid).get(),
    session.role === "HOD" ? getHodDepartmentScope(db, c, session.uid, { activeOnly: false }).then(editableDepartmentNames) : Promise.resolve([] as string[]),
  ]);
  return { uid: session.uid, name: (userSnap.data() as { name?: string } | undefined)?.name ?? "", facultyId, hodDepartments };
}

export function errorResponse(err: unknown, tag: string) {
  const bad = badBodyResponse(err);
  if (bad) return bad;
  if (err instanceof AdjustmentError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
  }
  console.error(`[${tag}]`, err);
  return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
}
