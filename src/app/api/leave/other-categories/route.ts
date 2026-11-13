export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { OTHER_CATEGORIES_COL } from "@/lib/leave/otherCategories";

// Principal/Vice Principal only - the one surface that ever reads the
// category a Principal assigned an "Other" leave request at approval time
// (see OtherLeaveCategory in src/types/leave.ts for why this lives in its
// own collection rather than on the request). Returns { requestId: category }
// for either one employee (?uid=) or the whole college.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL");
    const uid = new URL(request.url).searchParams.get("uid");

    const db = getAdminDb();
    let query: FirebaseFirestore.Query = OTHER_CATEGORIES_COL(session.collegeId, db);
    if (uid) query = query.where("uid", "==", uid);
    const snap = await query.get();

    const categories: Record<string, string> = {};
    snap.docs.forEach((d) => {
      const category = (d.data() as { category?: string }).category;
      if (category) categories[d.id] = category;
    });

    return NextResponse.json({ categories });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[leave/other-categories GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
