export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { loadUnavailability } from "@/lib/leave/availability";
import { handoverableRoles } from "@/lib/leave/roleDelegation";
import { listDepartmentPeople } from "@/lib/leave/roleHandoverPool";

// Feeds the "hand over my role" picker on the leave form. With no query it
// returns the seat roles the caller could hand over (empty = hide the picker)
// and the college's departments; with ?department= it returns that
// department's people, minus anyone on leave in the optional date range.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "ACADEMICS", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
    );
    const db = getAdminDb();
    const url = new URL(request.url);
    const department = url.searchParams.get("department");

    if (!department) {
      const [me, depts] = await Promise.all([
        db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get(),
        db.collection("colleges").doc(session.collegeId).collection("departments").get(),
      ]);
      const roles = handoverableRoles(me.data() as { role?: string; seatRoles?: string[] } | undefined);
      const departments = depts.docs
        .map((d) => d.data() as { name?: string; isActive?: boolean })
        .filter((d) => d.name && d.isActive !== false)
        .map((d) => d.name as string)
        .sort((a, b) => a.localeCompare(b));
      return NextResponse.json({ roles, departments });
    }

    let people = await listDepartmentPeople(db, session.collegeId, department, session.uid);
    const fromISO = url.searchParams.get("fromDate");
    const toISO = url.searchParams.get("toDate");
    if (fromISO && toISO && toISO >= fromISO && people.length > 0) {
      const busy = (await loadUnavailability(db, session.collegeId, fromISO, toISO)).unavailableUidsBetween(fromISO, toISO);
      people = people.filter((p) => !busy.has(p.uid));
    }
    return NextResponse.json({ people });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/role-handover-options GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
