export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";

// Every active college in the whole project (id + name only) - lets a
// publication's "Author Affiliation" picker offer every college in the
// project, not just this caller's own, since a paper's co-authors can be
// from a sibling college in the same group. Unlike every other
// college-scoped route, this deliberately reads OUTSIDE the caller's own
// collegeId - same pattern as src/app/api/management/colleges/route.ts,
// just role-opened to whoever can touch a publication at all instead of
// Management-only, and field-projected to id+name (not the full College doc).
export async function GET() {
  try {
    await requireCollegeMember(...PUBLICATION_ELIGIBLE_ROLES);

    const db = getAdminDb();
    // Sorted client-side (not .orderBy("name")) - combined with the
    // .where("isActive") filter, that would need a composite index this
    // project doesn't have, which fails the whole query silently from the
    // caller's point of view (caught below, reported as an empty list).
    const snap = await db.collection("colleges").where("isActive", "==", true).select("name").get();
    const colleges = snap.docs
      .map((d) => ({ id: d.id, name: (d.data() as { name?: string }).name ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ colleges });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/colleges-directory GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
