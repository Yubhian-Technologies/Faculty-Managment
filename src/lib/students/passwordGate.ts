import { NextResponse } from "next/server";
import type { StudentRecord } from "@/types";

// A student whose password is still the one-time one the college office issued
// (StudentRecord.mustChangePassword) is held at a "set a new password" screen
// by the student portal (components/students/StudentPasswordGate). This is the
// server-side half: every /api/college/student/me/* data route refuses such a
// student, so the screen can't simply be skipped by calling the API directly.
//
// What this does NOT prove: the new password is set in the browser with Firebase's
// own client SDK (the server never sees it), so clearing the flag is the student's
// own attestation (POST /api/college/student/me/password). The aim is to move
// students off a password the office knows, not to police them - and the worst a
// student can do by lying is keep using a password only they and the office hold.

export const PASSWORD_CHANGE_REQUIRED = "PASSWORD_CHANGE_REQUIRED";

export function passwordChangeRequired(student: Pick<StudentRecord, "mustChangePassword"> | null | undefined): boolean {
  return student?.mustChangePassword === true;
}

export function passwordChangeRequiredResponse() {
  return NextResponse.json(
    { error: "Please set a new password before continuing.", code: PASSWORD_CHANGE_REQUIRED },
    { status: 403 }
  );
}
