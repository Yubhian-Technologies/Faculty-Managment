export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { SUBJECT_CATEGORY_LABELS } from "@/types";

// Returns all distinct categories in use across the college's Subjects,
// unioned with the standard AICTE default categories.
export async function GET() {
  try {
    const session = await requireCollegeMember(
      "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS", "COLLEGE_OFFICE"
    );

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("subjects")
      .select("category")
      .get();

    const distinct = new Set<string>(
      Object.keys(SUBJECT_CATEGORY_LABELS).filter((c) => c !== "OTHER")
    );

    // Categories the college defined on Academics > Categories (code + full
    // form) are offered too, even before a subject uses them.
    const defined = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("subjectCategories")
      .get();
    const labels: Record<string, string> = {};
    for (const doc of defined.docs) {
      const { code, fullForm } = doc.data() as { code?: string; fullForm?: string };
      if (code && fullForm) {
        distinct.add(code);
        labels[code] = fullForm;
      }
    }

    for (const doc of snap.docs) {
      const cat = (doc.data() as { category?: string })?.category?.trim();
      if (cat && cat !== "OTHER") {
        distinct.add(cat);
      }
    }

    return NextResponse.json({ categories: Array.from(distinct), labels });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[subjects/categories GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
