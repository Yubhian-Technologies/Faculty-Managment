export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Book } from "@/types";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("LIBRARY", "PRINCIPAL", "VICE_PRINCIPAL");
    const { id } = await params;
    const body = (await request.json()) as Partial<Book>;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("books").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Book not found" }, { status: 404 });
    }
    const book = snap.data() as Book;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) {
      if (!body.title.trim()) return NextResponse.json({ error: "Title is required" }, { status: 400 });
      updates.title = body.title.trim();
    }
    if (body.author !== undefined) {
      if (!body.author.trim()) return NextResponse.json({ error: "Author is required" }, { status: 400 });
      updates.author = body.author.trim();
    }
    if (body.isbn !== undefined) updates.isbn = body.isbn.trim() || undefined;
    if (body.category !== undefined) updates.category = body.category.trim() || undefined;
    if (body.publisher !== undefined) updates.publisher = body.publisher.trim() || undefined;

    if (body.totalCopies !== undefined) {
      const totalCopies = Number(body.totalCopies);
      if (!Number.isInteger(totalCopies) || totalCopies < 1 || totalCopies > 10000) {
        return NextResponse.json({ error: "Total Copies must be an integer between 1 and 10000" }, { status: 400 });
      }
      // Copies currently out on loan is the floor - the catalog can't be
      // shrunk below what's actually in students' hands right now.
      const onLoan = book.totalCopies - book.availableCopies;
      if (totalCopies < onLoan) {
        return NextResponse.json(
          { error: `Cannot set Total Copies below ${onLoan} - that many are currently on loan` },
          { status: 400 }
        );
      }
      updates.totalCopies = totalCopies;
      updates.availableCopies = totalCopies - onLoan;
    }

    await ref.update(updates);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/library/books/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("LIBRARY", "PRINCIPAL", "VICE_PRINCIPAL");
    const { id } = await params;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("books").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Book not found" }, { status: 404 });
    }
    const book = snap.data() as Book;
    if (book.availableCopies < book.totalCopies) {
      return NextResponse.json({ error: "Cannot delete a book with copies currently on loan" }, { status: 400 });
    }

    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/library/books/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
