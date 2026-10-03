export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember, isDepartmentOffice } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { officeModuleCatalog, sanitizeOfficeHrefs } from "@/lib/departments/officeAccess";

// Which HOD modules this department's Department Office head may use.
//   GET  - the HOD (to edit) or the office head (to have their own sidebar
//          narrowed): { department, hrefs, catalog }. hrefs === null means never
//          configured, i.e. everything (the behaviour before this existed).
//   PUT  - the real HOD only: { hrefs: string[] } replaces the allowed list.
// The office head can read but never write, so they can't widen their own access.
// Stored at colleges/{id}/departmentOfficeAccess/{encoded department name}.

const docFor = (db: FirebaseFirestore.Firestore, collegeId: string, department: string) =>
  db.collection("colleges").doc(collegeId).collection("departmentOfficeAccess").doc(encodeURIComponent(department));

async function context() {
  const session = await requireCollegeMember("HOD");
  const db = getAdminDb();
  const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
  const department = scope.ownDepartmentNames[0] ?? "";
  return { session, db, department, ambiguous: scope.ownDepartmentNames.length > 1 };
}

const authError = (err: unknown) =>
  err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")
    ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    : null;

export async function GET() {
  try {
    const { session, db, department } = await context();
    if (!department) return NextResponse.json({ department: "", hrefs: null, catalog: officeModuleCatalog() });
    const snap = await docFor(db, session.collegeId, department).get();
    const hrefs = snap.exists ? ((snap.data() as { hrefs?: string[] }).hrefs ?? null) : null;
    return NextResponse.json({ department, hrefs, catalog: isDepartmentOffice(session) ? [] : officeModuleCatalog() });
  } catch (err) {
    const unauth = authError(err);
    if (unauth) return unauth;
    console.error("[college/department-office/access GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { session, db, department, ambiguous } = await context();
    if (isDepartmentOffice(session)) {
      return NextResponse.json({ error: "Only the Head of Department can change the Department Office's modules" }, { status: 403 });
    }
    if (ambiguous) {
      return NextResponse.json({ error: "You manage more than one department - switch to the one you are configuring first" }, { status: 400 });
    }
    if (!department) return NextResponse.json({ error: "You do not head a department" }, { status: 403 });

    const body = (await request.json().catch(() => ({}))) as { hrefs?: unknown };
    const hrefs = sanitizeOfficeHrefs(body.hrefs);
    if (!hrefs) return NextResponse.json({ error: "hrefs must be a list of known modules" }, { status: 400 });

    await docFor(db, session.collegeId, department).set({ department, hrefs, updatedBy: session.uid, updatedAt: new Date() });
    return NextResponse.json({ department, hrefs });
  } catch (err) {
    const unauth = authError(err);
    if (unauth) return unauth;
    console.error("[college/department-office/access PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
