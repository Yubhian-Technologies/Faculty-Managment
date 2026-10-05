export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Book } from "@/types";

// Book catalog CRUD - Library seat + Principal/VP, same guard set as
// api/college/circulars/route.ts's office/leadership split. Manual
// validation + thrown-shaped 400s, matching every comparable module in this
// codebase (circulars, budget-requests, designations) rather than zod, which
// has no local precedent among the routes this module sits beside.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("LIBRARY", "PRINCIPAL", "VICE_PRINCIPAL");
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim().toLowerCase();

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("books").orderBy("title").get();
    let books = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Book);
    if (search) {
      books = books.filter(
        (b) => b.title.toLowerCase().includes(search) || b.author.toLowerCase().includes(search) || b.isbn?.toLowerCase().includes(search)
      );
    }
    return NextResponse.json({ books });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/library/books GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("LIBRARY", "PRINCIPAL", "VICE_PRINCIPAL");
    const body = (await readJsonBody(request)) as Partial<Book>;

    const title = body.title?.trim();
    const author = body.author?.trim();
    const totalCopies = Number(body.totalCopies);
    if (!title || !author) {
      return NextResponse.json({ error: "Title and Author are required" }, { status: 400 });
    }
    if (!Number.isInteger(totalCopies) || totalCopies < 1 || totalCopies > 10000) {
      return NextResponse.json({ error: "Total Copies must be an integer between 1 and 10000" }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date();
    const ref = db.collection("colleges").doc(session.collegeId).collection("books").doc();
    await ref.set({
      collegeId: session.collegeId,
      title,
      author,
      isbn: body.isbn?.trim() || undefined,
      category: body.category?.trim() || undefined,
      publisher: body.publisher?.trim() || undefined,
      totalCopies,
      availableCopies: totalCopies,
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
    console.error("[college/library/books POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
