export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// The regulations of a programme and the intake batches each covers, as set
// under Academics > Regulation - what the results import offers for Regulation
// and Batch. Read-only; only those two fields are returned.
//   GET ?courseKey=<catalog id>

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const courseKey = new URL(request.url).searchParams.get("courseKey")?.trim() ?? "";
    // A course made before the catalog existed has no regulation settings.
    if (!courseKey || courseKey.startsWith("name:")) return NextResponse.json({ regulations: [] });
    const snap = await getAdminDb().collection("colleges").doc(session.collegeId).collection("courseCatalog").doc(courseKey).get();
    const data = snap.data() as { regulations?: string[]; regulationBatches?: Record<string, string> } | undefined;
    const regulations = (data?.regulations ?? []).map((regulation) => ({
      regulation,
      batches: String(data?.regulationBatches?.[regulation] ?? "")
        .split(",").map((b) => b.trim()).filter((b) => /^\d{4}-\d{4}$/.test(b)),
    }));
    return NextResponse.json({ regulations });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[exam-results/options GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
