export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET(request: Request) {
  try {
    await requireSuperAdmin();

    const { searchParams } = new URL(request.url);
    const collegeId = searchParams.get("collegeId");

    if (!collegeId) {
      return NextResponse.json({ error: "collegeId required" }, { status: 400 });
    }

    // Optional server-side date filters — additive; when absent behavior is unchanged.
    // Kept as best-effort: if a composite index is missing and Firestore throws,
    // we fall back to the original unfiltered query so callers never break; client
    // filteredLogs remains the fallback filter in all cases.
    const fromParam = searchParams.get("from")?.trim() ?? "";
    const toParam = searchParams.get("to")?.trim() ?? "";

    const db = getAdminDb();

    const fetchLogs = async (applyDateFilters: boolean) => {
      let q: FirebaseFirestore.Query = db
        .collection("colleges")
        .doc(collegeId)
        .collection("auditLogs")
        .orderBy("timestamp", "desc");
      if (applyDateFilters) {
        if (fromParam) {
          const fromDate = new Date(fromParam);
          if (!isNaN(fromDate.getTime())) q = q.where("timestamp", ">=", fromDate);
        }
        if (toParam) {
          const toDate = new Date(toParam);
          if (!isNaN(toDate.getTime())) {
            // inclusive end-of-day
            toDate.setHours(23, 59, 59, 999);
            q = q.where("timestamp", "<=", toDate);
          }
        }
      }
      return q.limit(100).get();
    };

    let snap: FirebaseFirestore.QuerySnapshot;
    if (fromParam || toParam) {
      try {
        snap = await fetchLogs(true);
      } catch (e) {
        console.warn("[admin/audit-logs GET] date-filtered query failed (likely missing index), falling back:", e);
        snap = await fetchLogs(false);
      }
    } else {
      snap = await fetchLogs(false);
    }

    const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ logs });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/audit-logs GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
