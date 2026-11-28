export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { paymentErrorResponse } from "@/lib/payments/server";
import { requireFeesCollector } from "@/lib/fees/http";
import { courseKeys, feeRefs } from "@/lib/fees/server";
import { academicYearOf } from "@/lib/fees/rules";

// Accounts > Fees (?collegeId): what the pickers offer - the college's courses (grouped like everywhere: catalog
// course), the admission batches its sections hold, the admission types its students have, and the current
// academic year.
export async function GET(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requireFeesCollector(db, request);
    const refs = feeRefs(db, session.collegeId);
    const [keys, sections, types] = await Promise.all([
      courseKeys(db, session.collegeId),
      refs.college.collection("sections").select("batch", "courseId").get(),
      refs.college.collection("students").select("admissionType").get(),
    ]);
    const courses = [...new Map([...keys.values()].map((k) => [k.key, k.name])).entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
    const batchesByCourse: Record<string, string[]> = {};
    for (const d of sections.docs) {
      const b = String(d.get("batch") ?? "").trim();
      const k = keys.get(String(d.get("courseId") ?? ""))?.key;
      if (!b || !k) continue;
      batchesByCourse[k] = [...new Set([...(batchesByCourse[k] ?? []), b])].sort().reverse();
    }
    const admissionTypes = [...new Set(types.docs.map((d) => String(d.get("admissionType") ?? "").trim().toUpperCase().replace(/\s+/g, " ")).filter(Boolean))].sort();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    return NextResponse.json({ courses, batchesByCourse, admissionTypes, academicYear: academicYearOf(today), today });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/options GET]");
  }
}
