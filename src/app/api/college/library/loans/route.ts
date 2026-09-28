export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { notify } from "@/lib/notify";
import type { Book, BookLoan, StudentRecord } from "@/types";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("LIBRARY", "PRINCIPAL", "VICE_PRINCIPAL");
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status"); // "ACTIVE" | "OVERDUE" | "RETURNED" | null (all)

    const db = getAdminDb();
    let query: FirebaseFirestore.Query = db.collection("colleges").doc(session.collegeId).collection("bookLoans");
    if (status) query = query.where("status", "==", status);
    const snap = await query.orderBy("borrowedAt", "desc").get();
    return NextResponse.json({ loans: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as BookLoan) });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/library/loans GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Borrow a book - transactional (reserve the loan doc id outside the
// transaction, re-read the book fresh inside it before decrementing
// availableCopies), same shape as budget-requests/[id]/route.ts's
// approve-path transaction, so two librarians racing to lend the last copy
// can't both succeed.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("LIBRARY", "PRINCIPAL", "VICE_PRINCIPAL");
    const body = (await request.json()) as { studentId?: string; bookId?: string };
    const studentId = body.studentId?.trim();
    const bookId = body.bookId?.trim();
    if (!studentId || !bookId) {
      return NextResponse.json({ error: "studentId and bookId are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const bookRef = collegeRef.collection("books").doc(bookId);
    const studentRef = collegeRef.collection("students").doc(studentId);

    const [studentSnap, settings] = await Promise.all([studentRef.get(), loadCollegeSettings(db, session.collegeId)]);
    if (!studentSnap.exists) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }
    const student = studentSnap.data() as StudentRecord;

    const loanRef = collegeRef.collection("bookLoans").doc();
    const now = new Date();
    const dueAt = new Date(now.getTime() + (settings.libraryLoanDurationDays ?? 14) * 86_400_000);

    let bookTitle = "";
    try {
      await db.runTransaction(async (tx) => {
        const freshBook = await tx.get(bookRef);
        if (!freshBook.exists) throw new Error("BOOK_NOT_FOUND");
        const book = freshBook.data() as Book;
        if (book.availableCopies <= 0) throw new Error("NO_COPIES_AVAILABLE");
        bookTitle = book.title;

        tx.update(bookRef, { availableCopies: book.availableCopies - 1, updatedAt: now });
        tx.set(loanRef, {
          collegeId: session.collegeId,
          studentId,
          studentUid: student.uid ?? "",
          studentName: student.name,
          studentRollNumber: student.rollNumber,
          bookId,
          bookTitle: book.title,
          borrowedAt: now,
          dueAt,
          status: "ACTIVE",
          renewalCount: 0,
          issuedBy: session.uid,
          issuedByName: session.email,
          createdAt: now,
          updatedAt: now,
        });
      });
    } catch (txErr) {
      if (txErr instanceof Error && txErr.message === "BOOK_NOT_FOUND") {
        return NextResponse.json({ error: "Book not found" }, { status: 404 });
      }
      if (txErr instanceof Error && txErr.message === "NO_COPIES_AVAILABLE") {
        return NextResponse.json(
          { error: "No copies available - join the reservation queue instead", code: "NO_COPIES_AVAILABLE" },
          { status: 409 }
        );
      }
      throw txErr;
    }

    if (student.uid) {
      await notify(
        db,
        session.collegeId,
        student.uid,
        "BOOK_BORROWED",
        "Book Borrowed",
        `You borrowed "${bookTitle}" - due back by ${dueAt.toDateString()}.`,
        "/student/library"
      );
    }

    return NextResponse.json({ ok: true, id: loanRef.id });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/library/loans POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
