export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import type { UserRole } from "@/types";

type ImportRow = {
  ownerName: string;
  title: string;
  authorFullNames?: string;
  authors?: string;
  sourceTitle?: string;
  year: string;
  indexed?: string;
  doi?: string;
  paperLink?: string;
  scopusLink?: string;
};

// Case/punctuation-insensitive so "Bharathi D.V.N." and "Bharathi, D.V.N."
// both resolve to the same stored account name.
function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");
}

// Real exports label this column "Year" (a plain 4-digit value) or "Month &
// Year" (which in practice still only ever carries the year) - pull the
// first 4-digit run out of whichever one is present instead of assuming a
// fixed format.
function extractYear(raw: string | undefined): number | undefined {
  const m = raw?.match(/\d{4}/);
  if (!m) return undefined;
  const year = Number(m[0]);
  return year >= 1900 && year <= 2100 ? year : undefined;
}

function toLink(doi: string | undefined, paperLink: string | undefined, scopusLink: string | undefined): string {
  const d = doi?.trim();
  if (d) return /^https?:\/\//i.test(d) ? d : `https://doi.org/${d.replace(/^doi:\s*/i, "")}`;
  if (paperLink?.trim()) return paperLink.trim();
  if (scopusLink?.trim()) return scopusLink.trim();
  return "";
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("R_AND_D");
    const body = (await request.json()) as { records: ImportRow[] };

    if (!body.records || !Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }
    if (body.records.length > 500) {
      return NextResponse.json({ error: "Maximum 500 records per import" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;

    // Publications are only ever attributed to a staff login account (any
    // role) - same as the Add Publication form's staff picker (see
    // /api/college/users?includeAll=true) - not to a bare FacultyMember
    // record, which may not have a login at all.
    const usersSnap = await db.collection("colleges").doc(collegeId).collection("users").get();
    const byNormalizedName = new Map<string, { uid: string; name: string; role?: UserRole }>();
    for (const doc of usersSnap.docs) {
      const data = doc.data() as { name?: string; role?: UserRole };
      if (!data.name) continue;
      const key = normalizeName(data.name);
      if (!byNormalizedName.has(key)) byNormalizedName.set(key, { uid: doc.id, name: data.name, role: data.role }); // first match wins on duplicate names
    }

    let addedByName = "R&D";
    try {
      const addedBySnap = await db.collection("colleges").doc(collegeId).collection("users").doc(session.uid).get();
      addedByName = (addedBySnap.data() as { name?: string } | undefined)?.name ?? "R&D";
    } catch { /* best-effort */ }

    const now = new Date();
    const created: string[] = [];
    const failed: { row: number; ownerName: string; error: string }[] = [];
    const batch = new ChunkedBatch(db);

    for (let i = 0; i < body.records.length; i++) {
      const row = body.records[i];
      const rowNum = i + 2; // 1-indexed + header row
      const rawOwnerName = row.ownerName?.trim() ?? "";

      if (!rawOwnerName) { failed.push({ row: rowNum, ownerName: "-", error: "SVECW-First Author is required" }); continue; }
      if (!row.title?.trim()) { failed.push({ row: rowNum, ownerName: rawOwnerName, error: "Title is required" }); continue; }

      const journalOrConference = row.sourceTitle?.trim() || "";
      if (!journalOrConference) { failed.push({ row: rowNum, ownerName: rawOwnerName, error: "Source Title / Journal / Conference is required" }); continue; }

      const publicationYear = extractYear(row.year);
      if (!publicationYear) { failed.push({ row: rowNum, ownerName: rawOwnerName, error: "A valid Year is required" }); continue; }

      const owner = byNormalizedName.get(normalizeName(rawOwnerName));
      if (!owner) {
        failed.push({ row: rowNum, ownerName: rawOwnerName, error: `No staff login account found matching "${rawOwnerName}" - check spelling, or set up their login first` });
        continue;
      }

      const coAuthors = row.authorFullNames?.trim() || row.authors?.trim() || "";
      const driveLink = toLink(row.doi, row.paperLink, row.scopusLink);
      const indexing = row.indexed?.trim() || "";

      const docRef = db.collection("colleges").doc(collegeId).collection("publications").doc();
      batch.set(docRef, {
        collegeId,
        uid: owner.uid,
        ownerName: owner.name,
        ownerRole: owner.role,
        title: row.title.trim(),
        coAuthors,
        journalOrConference,
        publicationYear,
        ...(indexing ? { indexing } : {}),
        ...(driveLink ? { driveLink } : {}),
        addedBy: session.uid,
        addedByName,
        createdAt: now,
        updatedAt: now,
      });

      created.push(rawOwnerName);
    }

    await batch.commit();

    return NextResponse.json({ created: created.length, failed, warnings: [] }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/publications/import POST]", err);
    const detail = process.env.NODE_ENV !== "production" ? `: ${err instanceof Error ? err.message : String(err)}` : "";
    return NextResponse.json({ error: `Internal error${detail}` }, { status: 500 });
  }
}
