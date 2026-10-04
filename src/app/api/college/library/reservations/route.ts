export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Book, BookReservation, StudentRecord } from "@/types";

// FIFO reservation queue for a book with no copies currently available.
// Notify-only on return (see loans/[id]/return/route.ts) rather than
// auto-creating a loan - a student who's moved on since queuing shouldn't be
// silently handed a loan (and its overdue-fine liability) they never picked
// up. Library seat + Principal/VP only - a student joins the queue by asking
// the librarian, same as borrowing itself; there is no student-initiated
// write path in v1.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("LIBRARY", "PRINCIPAL", "VICE_PRINCIPAL");
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get("bookId");

    const db = getAdminDb();
    let query: FirebaseFirestore.Query = db.collection("colleges").doc(session.collegeId).collection("bookReservations");
    if (bookId) query = query.where("bookId", "==", bookId);
    const snap = await query.orderBy("queuedAt", "asc").get();
    return NextResponse.json({ reservations: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as BookReservation) });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/library/reservations GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("LIBRARY", "PRINCIPAL", "VICE_PRINCIPAL");
    const body = (await readJsonBody(request)) as { studentId?: string; bookId?: string };
    const studentId = body.studentId?.trim();
    const bookId = body.bookId?.trim();
    if (!studentId || !bookId) {
      return NextResponse.json({ error: "studentId and bookId are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const [studentSnap, bookSnap] = await Promise.all([
      collegeRef.collection("students").doc(studentId).get(),
      collegeRef.collection("books").doc(bookId).get(),
    ]);
    if (!studentSnap.exists) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    if (!bookSnap.exists) return NextResponse.json({ error: "Book not found" }, { status: 404 });
    const student = studentSnap.data() as StudentRecord;
    const book = bookSnap.data() as Book;

    if (book.availableCopies > 0) {
      return NextResponse.json({ error: "This book has copies available - borrow it directly instead" }, { status: 400 });
    }

    const existingSnap = await collegeRef
      .collection("bookReservations")
      .where("bookId", "==", bookId)
      .where("studentId", "==", studentId)
      .where("status", "in", ["WAITING", "NOTIFIED"])
      .limit(1)
      .get();
    if (!existingSnap.empty) {
      return NextResponse.json({ error: "This student is already in the queue for this book" }, { status: 400 });
    }

    const now = new Date();
    const ref = collegeRef.collection("bookReservations").doc();
    await ref.set({
      collegeId: session.collegeId,
      studentId,
      studentUid: student.uid ?? "",
      studentName: student.name,
      bookId,
      bookTitle: book.title,
      queuedAt: now,
      status: "WAITING",
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ ok: true, id: ref.id });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/library/reservations POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
