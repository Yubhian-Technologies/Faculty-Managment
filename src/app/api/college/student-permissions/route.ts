export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { ApprovalError } from "@/lib/approvals";
import { actingUser, ANY_PERMISSION_ROLE, authenticate, failure, OVERSIGHT_ROLES, pageOptions, readJson, STUDENT_ROLE } from "@/lib/studentPermissions/http";
import { createFacultyRequests, createStudentRequest, FACULTY_RAISER_ROLES, listForOversight, listInbox, listMine } from "@/lib/studentPermissions/service";

// Student permission requests.
//   GET  ?view=mine      requests I raised (a student also sees those raised for them)
//   GET  ?view=inbox     requests waiting for MY decision
//   GET  ?view=oversight everything in the departments I oversee (HOD / Vice Principal / Principal)
//   POST                 raise one: a student for themselves, or faculty for a group of students

export async function GET(request: Request) {
  try {
    const session = await authenticate(...ANY_PERMISSION_ROLE);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "mine";
    const opts = pageOptions(url);

    if (view === "mine") return NextResponse.json({ requests: await listMine(db, user, opts) });
    if (view === "inbox") {
      if (user.roles.includes(STUDENT_ROLE) && user.roles.length === 1) return NextResponse.json({ requests: [] });
      return NextResponse.json({ requests: await listInbox(db, user, opts) });
    }
    if (view === "oversight") {
      if (!OVERSIGHT_ROLES.some((r) => user.roles.includes(r))) throw new ApprovalError("FORBIDDEN", "You can't view this", 403);
      return NextResponse.json({ requests: await listForOversight(db, user, opts) });
    }
    throw new ApprovalError("INVALID", "Unknown view", 400);
  } catch (err) {
    return failure(err, "college/student-permissions GET");
  }
}

export async function POST(request: Request) {
  try {
    const session = await authenticate(...ANY_PERMISSION_ROLE);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const body = await readJson(request);

    // A student raises for themselves; anyone else raises for the students they pick.
    if (session.role === STUDENT_ROLE) {
      return NextResponse.json({ requests: [await createStudentRequest(db, user, body)] }, { status: 201 });
    }
    if (!FACULTY_RAISER_ROLES.some((r) => user.roles.includes(r))) throw new ApprovalError("FORBIDDEN", "You can't raise a request for students", 403);
    return NextResponse.json({ requests: await createFacultyRequests(db, user, body) }, { status: 201 });
  } catch (err) {
    return failure(err, "college/student-permissions POST");
  }
}
