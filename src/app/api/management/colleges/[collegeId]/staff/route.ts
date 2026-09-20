export const dynamic = "force-dynamic";

import { findUsersByRoles } from "@/lib/roles/findUsersByRoles";
import { isSeatRole } from "@/lib/roles/seatRoles";
import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getPublicationsForUid } from "@/lib/firestore/publications";

// MANAGEMENT is read-only - this route only implements GET.
// Returns the first matching college-scoped user for a role (PRINCIPAL / VICE_PRINCIPAL / HOD),
// optionally filtered by department - mirrors the dedup convention used in college/users GET.
export async function GET(request: Request, { params }: { params: Promise<{ collegeId: string }> }) {
  try {
    await requireManagement();
    const { collegeId } = await params;
    const { searchParams } = new URL(request.url);
    const role = searchParams.get("role");
    const department = searchParams.get("department");

    if (!role) {
      return NextResponse.json({ error: "role is required" }, { status: 400 });
    }

    const db = getAdminDb();
    // The person in a seat (Principal, a department's HOD, ...) may be a faculty
    // member whose own role is something else - see lib/roles/findUsersByRoles.
    let matched: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    if (isSeatRole(role)) {
      const docs = await findUsersByRoles(db, collegeId, [role], { exact: true });
      matched = docs.find((d) => {
        if (!department) return true;
        const u = d.data() as { department?: string; departments?: string[] };
        return u.department === department || (u.departments ?? []).includes(department);
      });
    } else {
      let q = db.collection("colleges").doc(collegeId).collection("users").where("role", "==", role) as FirebaseFirestore.Query;
      if (department) q = q.where("department", "==", department);
      matched = (await q.limit(1).get()).docs[0];
    }
    const profile = matched ? { uid: matched.id, ...matched.data() } : null;
    const publications = profile ? await getPublicationsForUid(db, collegeId, profile.uid) : [];

    return NextResponse.json({ profile, publications });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[management/colleges/staff GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
