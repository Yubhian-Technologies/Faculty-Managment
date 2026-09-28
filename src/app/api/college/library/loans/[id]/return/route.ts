export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { calcFine } from "@/lib/library/fine";
import { notify } from "@/lib/notify";
import type { Book, BookLoan, BookReservation } from "@/types";

function toDate(v: unknown): Date {
  const t = v as { toDate?: () => Date };
  return typeof t?.toDate === "function" ? t.toDate() : new Date(v as string);
}

// Return a book - transactional (re-read the loan fresh, fail closed if it's
// already returned), then increments availableCopies. After the transaction
// commits, notifies (does NOT auto-lend to) the next WAITING reservation for
// this book, if any - see reservations/route.ts's own doc-comment for why
// notify-only beats auto-promoting a loan.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("LIBRARY", "PRINCIPAL", "VICE_PRINCIPAL");
    const { id } = await params;

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const loanRef = collegeRef.collection("bookLoans").doc(id);
    const settings = await loadCollegeSettings(db, session.collegeId);
    const now = new Date();

    let bookId = "";
    let fineAmount = 0;
    try {
      await db.runTransaction(async (tx) => {
        const freshLoan = await tx.get(loanRef);
        if (!freshLoan.exists) throw new Error("LOAN_NOT_FOUND");
        const loan = freshLoan.data() as BookLoan;
        if (loan.status === "RETURNED") throw new Error("ALREADY_RETURNED");
        bookId = loan.bookId;

        const bookRef = collegeRef.collection("books").doc(loan.bookId);
        const freshBook = await tx.get(bookRef);
        const book = freshBook.exists ? (freshBook.data() as Book) : null;

        fineAmount = calcFine(toDate(loan.dueAt), now, settings.libraryFinePerDay ?? 1);

        tx.update(loanRef, { status: "RETURNED", returnedAt: now, fineAmount, updatedAt: now });
        if (book) {
          tx.update(bookRef, { availableCopies: Math.min(book.totalCopies, book.availableCopies + 1), updatedAt: now });
        }
      });
    } catch (txErr) {
      if (txErr instanceof Error && txErr.message === "LOAN_NOT_FOUND") {
        return NextResponse.json({ error: "Loan not found" }, { status: 404 });
      }
      if (txErr instanceof Error && txErr.message === "ALREADY_RETURNED") {
        return NextResponse.json({ error: "This book has already been returned" }, { status: 409 });
      }
      throw txErr;
    }

    // Notify (not auto-lend) the next student waiting for this book, if any.
    const nextReservationSnap = await collegeRef
      .collection("bookReservations")
      .where("bookId", "==", bookId)
      .where("status", "==", "WAITING")
      .orderBy("queuedAt", "asc")
      .limit(1)
      .get();
    if (!nextReservationSnap.empty) {
      const resDoc = nextReservationSnap.docs[0];
      const reservation = resDoc.data() as BookReservation;
      await resDoc.ref.update({ status: "NOTIFIED", updatedAt: now });
      if (reservation.studentUid) {
        await notify(
          db,
          session.collegeId,
          reservation.studentUid,
          "BOOK_RESERVATION_AVAILABLE",
          "Reserved Book Available",
          `"${reservation.bookTitle}" is now available - visit the library to borrow it.`,
          "/student/library"
        );
      }
    }

    return NextResponse.json({ ok: true, fineAmount });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/library/loans/[id]/return PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
