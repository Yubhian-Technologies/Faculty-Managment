export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

interface BookImportRow {
  title?: string;
  author?: string;
  isbn?: string;
  category?: string;
  publisher?: string;
  totalCopies?: string | number;
}

const MAX_ROWS = 500;

// Bulk book-catalog import - takes already-parsed rows (client-side
// parseExcelFile/parseCSV + matchHeaders, same two-step pattern every other
// bulk-import page in this codebase uses; see students/import-excel/route.ts).
// ISBN is required per row (stricter than the single Add Book form, which
// leaves it optional) - a bulk catalog load is expected to come from an
// existing library system's export, which already has ISBNs on file.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("LIBRARY", "PRINCIPAL", "VICE_PRINCIPAL");
    const body = (await request.json()) as { records?: BookImportRow[] };

    const records = Array.isArray(body.records) ? body.records : [];
    if (records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }
    if (records.length > MAX_ROWS) {
      return NextResponse.json({ error: `Maximum ${MAX_ROWS} records per import` }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const now = new Date();

    const failed: { row: number; title: string; error: string }[] = [];
    let created = 0;

    // Sequential, not batched - a duplicate-ISBN check per row needs to see
    // earlier rows in this same file, and catalogs this size (hundreds, not
    // thousands) don't need chunked-batch write throughput.
    const seenIsbns = new Set<string>();
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const rowNum = i + 2; // +1 for header row, +1 for 1-indexing
      const title = r.title?.trim() ?? "";
      const author = r.author?.trim() ?? "";
      const isbn = r.isbn?.trim() ?? "";
      const totalCopies = Number(r.totalCopies);

      if (!title || !author || !isbn) {
        failed.push({ row: rowNum, title: title || "(untitled)", error: "Title, Author and ISBN are required" });
        continue;
      }
      if (!Number.isInteger(totalCopies) || totalCopies < 1 || totalCopies > 10000) {
        failed.push({ row: rowNum, title, error: "Total Copies must be an integer between 1 and 10000" });
        continue;
      }
      if (seenIsbns.has(isbn.toLowerCase())) {
        failed.push({ row: rowNum, title, error: `Duplicate ISBN in this file: ${isbn}` });
        continue;
      }
      seenIsbns.add(isbn.toLowerCase());

      const dupSnap = await collegeRef.collection("books").where("isbn", "==", isbn).limit(1).get();
      if (!dupSnap.empty) {
        failed.push({ row: rowNum, title, error: `A book with ISBN ${isbn} already exists in the catalog` });
        continue;
      }

      await collegeRef.collection("books").doc().set({
        collegeId: session.collegeId,
        title,
        author,
        isbn,
        category: r.category?.trim() || undefined,
        publisher: r.publisher?.trim() || undefined,
        totalCopies,
        availableCopies: totalCopies,
        createdAt: now,
        updatedAt: now,
      });
      created++;
    }

    return NextResponse.json({ created, failed });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/library/books/import POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
