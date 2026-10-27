export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { cachedCollectionDocs } from "@/lib/firestore/sharedReads";
import { mentoringErrorResponse } from "@/lib/mentoring/http";

// The Principal / Vice-Principal student finder's pick lists: the college's departments and the
// (department, year, section) combinations that exist. Only the college's own section docs (three
// fields each) are read - no student is.
export async function GET() {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL");
    const db = getAdminDb();
    const [deptDocs, sectionDocs] = await Promise.all([
      cachedCollectionDocs(db, session.collegeId, "departments"),
      db.collection("colleges").doc(session.collegeId).collection("sections").select("department", "year", "name").get().then((snap) => snap.docs),
    ]);
    const departments = [...new Set(deptDocs.map((d) => (d.data() as { name?: string }).name ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const seen = new Set<string>();
    const sections: { department: string; year: number; name: string }[] = [];
    for (const d of sectionDocs) {
      const s = d.data() as { department?: string; year?: number; name?: string };
      if (!s.department || typeof s.year !== "number" || !s.name) continue;
      const key = `${s.department}|${s.year}|${s.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sections.push({ department: s.department, year: s.year, name: s.name });
    }
    sections.sort((a, b) => a.department.localeCompare(b.department) || a.year - b.year || a.name.localeCompare(b.name));
    return NextResponse.json({ departments, sections });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/college-students/options GET]");
  }
}
