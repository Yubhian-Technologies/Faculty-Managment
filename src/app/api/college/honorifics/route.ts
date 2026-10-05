export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { honorificKey } from "@/lib/honorifics/config";

// Who may ADD/EDIT/DELETE - Principal-owned, same as the request that created
// this catalog ("in Principal Settings... principal can configure"). Read
// access (GET) is broader, same reasoning as the Designation Catalog's own
// split: any staff role may eventually need to pick an honorific somewhere,
// even though only Principal/VP/Super Admin curate the list itself.
export const MANAGE_ROLES = ["PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"];

// colleges/{collegeId}/honorifics - each college's own admin-curated list of
// name prefixes (Mr., Mrs., Dr., Prof., ...), same "add it here once, pick it
// everywhere else" model as the Designation Catalog.

export async function GET() {
  try {
    const session = await requireCollegeMember(
      "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE", "COLLEGE_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF"
    );
    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("honorifics").get();
    const items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((a as { name?: string }).name ?? "").localeCompare((b as { name?: string }).name ?? ""));

    return NextResponse.json({ items });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[honorifics GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...MANAGE_ROLES);
    const body = (await readJsonBody(request)) as { name?: string };

    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const coll = db.collection("colleges").doc(session.collegeId).collection("honorifics");

    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? session.email ?? "Unknown";
    const now = new Date();

    // Same atomic check-then-add as the Designation Catalog POST - prevents a
    // double-submit from creating two entries with the same name.
    const ref = coll.doc();
    let duplicateError: string | null = null;
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(coll);
      const nameKey = honorificKey(name);
      const clash = existing.docs.find((d) => honorificKey((d.data() as { name?: string }).name) === nameKey);
      if (clash) {
        duplicateError = "An honorific with this name already exists";
        return;
      }
      tx.set(ref, {
        collegeId: session.collegeId,
        name,
        isActive: true,
        createdBy: session.uid,
        createdByName: actorName,
        createdAt: now,
        updatedAt: now,
      });
    });
    if (duplicateError) {
      return NextResponse.json({ error: duplicateError }, { status: 409 });
    }

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[honorifics POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
