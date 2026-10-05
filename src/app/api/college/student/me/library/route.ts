export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { passwordChangeRequired, passwordChangeRequiredResponse } from "@/lib/students/passwordGate";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { calcFine, daysOverdue, isOverdue } from "@/lib/library/fine";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import type { BookLoan, BookReservation, StudentRecord } from "@/types";

function toDate(v: unknown): Date {
  const t = v as { toDate?: () => Date };
  return typeof t?.toDate === "function" ? t.toDate() : new Date(v as string);
}

// Student's own active loans + reservations - resolved from session.uid only
// (the student's own route does its own lookup; library staff never query on
// the student's behalf at read time, per the plan's own requirement). Live
// overdue-days/fine computed on read (no cron - see the plan's deferred
// due-date-reminders decision).
export async function GET() {
  try {
    const session = await requireCollegeMember("STUDENT");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const studentSnap = await collegeRef.collection("students").where("uid", "==", session.uid).limit(1).get();
    if (studentSnap.empty) {
      return NextResponse.json({ loans: [], reservations: [] });
    }
    const studentId = studentSnap.docs[0].id;
    const student = studentSnap.docs[0].data() as StudentRecord;
    if (passwordChangeRequired(student)) return passwordChangeRequiredResponse();

    const [loansSnap, reservationsSnap, settings] = await Promise.all([
      collegeRef.collection("bookLoans").where("studentId", "==", studentId).where("status", "in", ["ACTIVE", "OVERDUE"]).get(),
      collegeRef.collection("bookReservations").where("studentId", "==", studentId).where("status", "in", ["WAITING", "NOTIFIED"]).get(),
      loadCollegeSettings(db, session.collegeId),
    ]);

    const now = new Date();
    const loans = loansSnap.docs.map((d) => {
      const loan = { ...(d.data() as BookLoan), id: d.id };
      const dueAt = toDate(loan.dueAt);
      return {
        ...loan,
        isOverdue: isOverdue(dueAt, now),
        daysOverdue: daysOverdue(dueAt, now),
        liveFineAmount: isOverdue(dueAt, now) ? calcFine(dueAt, now, settings.libraryFinePerDay ?? 1) : 0,
      };
    });
    const reservations = reservationsSnap.docs.map((d) => ({ ...(d.data() as BookReservation), id: d.id }));

    return NextResponse.json({ loans, reservations, studentName: student.name });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student/me/library GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
