export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { DesignationCadre, DesignationCategory } from "@/types";

const CATEGORIES: DesignationCategory[] = ["FACULTY", "TECHNICAL", "NON_TECHNICAL"];
const CADRES: DesignationCadre[] = ["PROFESSOR", "ASSOCIATE_PROFESSOR", "ASSISTANT_PROFESSOR"];

// Which roles may ADD/EDIT/DELETE each category - mirrors the existing,
// previously-contentious Technical/Non-Technical Supporting Staff ownership
// split (see project_technical_staff_ownership memory): Technical stays
// HOD-owned, Non-Technical stays Principal/VP/College Office-owned. Faculty
// is Principal/VP-owned. Read access (GET) is broader - every role that
// populates a designation dropdown somewhere needs to fetch this list.
export const MANAGE_ROLES_BY_CATEGORY: Record<DesignationCategory, string[]> = {
  FACULTY: ["PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"],
  TECHNICAL: ["HOD", "SUPER_ADMIN"],
  NON_TECHNICAL: ["PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE", "SUPER_ADMIN"],
};

// colleges/{collegeId}/designations - each college's own admin-curated list of
// job titles, same "add it here once, pick it everywhere else" model as
// course-catalog. Nothing hardcoded per college type any more.

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE", "COLLEGE_ADMIN"
    );
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");

    const db = getAdminDb();
    let query: FirebaseFirestore.Query = db.collection("colleges").doc(session.collegeId).collection("designations");
    if (category) query = query.where("category", "==", category);

    const snap = await query.get();
    const items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((a as { name?: string }).name ?? "").localeCompare((b as { name?: string }).name ?? ""));

    return NextResponse.json({ items });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[designations GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE");
    const body = (await request.json()) as { name?: string; category?: string; cadre?: string };

    const name = body.name?.trim();
    const category = body.category as DesignationCategory | undefined;
    if (!name || !category || !CATEGORIES.includes(category)) {
      return NextResponse.json({ error: "name and a valid category are required" }, { status: 400 });
    }
    if (!MANAGE_ROLES_BY_CATEGORY[category].includes(session.role)) {
      return NextResponse.json({ error: "You cannot manage this category's designations" }, { status: 403 });
    }
    const cadre = body.cadre?.trim();
    if (cadre && (category !== "FACULTY" || !CADRES.includes(cadre as DesignationCadre))) {
      return NextResponse.json({ error: "Invalid cadre" }, { status: 400 });
    }

    const db = getAdminDb();
    const coll = db.collection("colleges").doc(session.collegeId).collection("designations");

    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? session.email ?? "Unknown";
    const now = new Date();

    // Same atomic check-then-add as course-catalog POST - prevents a
    // double-submit from creating two entries with the same name.
    const ref = coll.doc();
    let duplicateError: string | null = null;
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(coll.where("category", "==", category));
      const nameKey = name.toLowerCase();
      const clash = existing.docs.find((d) => ((d.data() as { name?: string }).name ?? "").trim().toLowerCase() === nameKey);
      if (clash) {
        duplicateError = "A designation with this name already exists";
        return;
      }
      tx.set(ref, {
        collegeId: session.collegeId,
        name,
        category,
        ...(cadre ? { cadre } : {}),
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
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[designations POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
