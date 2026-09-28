export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import type { BookLoan } from "@/types";

function toDate(v: unknown): Date {
  const t = v as { toDate?: () => Date };
  return typeof t?.toDate === "function" ? t.toDate() : new Date(v as string);
}

// Extends a loan's due date by the college's configured loan duration -
// rejected if someone else is already waiting for this book (can't renew a
// copy out from under the reservation queue).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("LIBRARY", "PRINCIPAL", "VICE_PRINCIPAL");
    const { id } = await params;

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const loanRef = collegeRef.collection("bookLoans").doc(id);
    const loanSnap = await loanRef.get();
    if (!loanSnap.exists) {
      return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    }
    const loan = loanSnap.data() as BookLoan;
    if (loan.status === "RETURNED") {
      return NextResponse.json({ error: "This book has already been returned" }, { status: 409 });
    }

    const waitingSnap = await collegeRef
      .collection("bookReservations")
      .where("bookId", "==", loan.bookId)
      .where("status", "==", "WAITING")
      .limit(1)
      .get();
    if (!waitingSnap.empty) {
      return NextResponse.json(
        { error: "Another student is waiting for this book - it cannot be renewed" },
        { status: 409 }
      );
    }

    const settings = await loadCollegeSettings(db, session.collegeId);
    const now = new Date();
    const newDueAt = new Date(toDate(loan.dueAt).getTime() + (settings.libraryLoanDurationDays ?? 14) * 86_400_000);

    await loanRef.update({
      dueAt: newDueAt,
      renewalCount: (loan.renewalCount ?? 0) + 1,
      status: "ACTIVE",
      updatedAt: now,
    });

    return NextResponse.json({ ok: true, dueAt: newDueAt.toISOString() });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/library/loans/[id]/renew PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
