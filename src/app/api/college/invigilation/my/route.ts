export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { dutiesCol, invigilationError } from "@/lib/invigilation/server";
import { MY_DUTY_ROLES } from "@/lib/invigilation/rolesList";
import type { InvigilationDuty } from "@/types/invigilation";

// A faculty member's own exam duties - published ones only (a draft is the
// Exam Cell's until it publishes that exam). ?exists=1 answers the menu.

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...MY_DUTY_ROLES);
    const db = getAdminDb();
    const facultyId = await resolveFacultyMemberId(db, session.collegeId, session.uid);
    const snap = await dutiesCol(db, session.collegeId).where("facultyId", "==", facultyId).get();
    const duties = snap.docs.map((d) => ({ ...(d.data() as InvigilationDuty), id: d.id }))
      // Published at some point; a cancelled / handed-over one stays listed as such.
      .filter((d) => Boolean(d.publishedAt))
      .sort((a, b) => a.date.localeCompare(b.date) || a.from.localeCompare(b.from));
    if (new URL(request.url).searchParams.get("exists") === "1") return NextResponse.json({ exists: duties.length > 0 });
    return NextResponse.json({
      duties: duties.map((d) => ({ id: d.id, date: d.date, from: d.from, to: d.to, category: d.category, room: d.room ?? "", block: d.block ?? "", status: d.status })),
    });
  } catch (err) {
    return invigilationError(err, "[invigilation/my GET]");
  }
}
