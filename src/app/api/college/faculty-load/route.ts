export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Read-only: how many hours a week each listed faculty member already teaches
// (current teaching assignments, same rule as the Teaching Load table: past and
// non-teaching subjects are left out). Shown beside faculty pickers so whoever
// assigns or lends a person can see their load first. Only a count and hours are
// returned - nothing personal.
// ponytail: counts every current assignment regardless of semester; narrow by semester if two semesters ever overlap.
const MAX_IDS = 150;

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF");
    const ids = Array.from(new Set((new URL(request.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))).slice(0, MAX_IDS);
    const loads: Record<string, { hours: number; subjects: number }> = {};
    for (const id of ids) loads[id] = { hours: 0, subjects: 0 };
    if (ids.length === 0) return NextResponse.json({ loads });

    const coll = getAdminDb().collection("colleges").doc(session.collegeId).collection("teachingAssignments");
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
    const snaps = await Promise.all(chunks.map((c) => coll.where("facultyId", "in", c).get()));
    for (const snap of snaps) {
      for (const d of snap.docs) {
        const a = d.data() as { facultyId?: string; hoursPerWeek?: number; isPast?: boolean; excludeFromResume?: boolean; isNonTeachingLoad?: boolean; subjectType?: string };
        if (!a.facultyId || !loads[a.facultyId]) continue;
        if (a.isPast || a.excludeFromResume || a.isNonTeachingLoad || a.subjectType === "NON_TEACHING") continue;
        loads[a.facultyId].hours += Number(a.hoursPerWeek) || 0;
        loads[a.facultyId].subjects += 1;
      }
    }
    return NextResponse.json({ loads });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/faculty-load GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
