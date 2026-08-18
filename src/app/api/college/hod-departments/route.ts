export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Bulk-reconciles which top-level departments one HOD heads, in a single
// save - the "Manage Departments" control on the Principal's Departments
// page. Principal/VP/Super Admin only - an HOD can't grant themself another
// department. Mirrors the same additive semantics the single-department
// "Assign HOD" dropdown uses (college/departments PATCH) so the two entry
// points never fight each other: a department newly checked here is added to
// this HOD (evicting whichever different HOD it previously had, same as the
// dropdown); a department unchecked here is released from just this HOD,
// leaving every other department they still run untouched.
export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as { hodUid?: string; departmentIds?: string[] };
    if (!body.hodUid || !Array.isArray(body.departmentIds)) {
      return NextResponse.json({ error: "hodUid and departmentIds are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;
    const usersColl = db.collection("colleges").doc(collegeId).collection("users");
    const deptsColl = db.collection("colleges").doc(collegeId).collection("departments");

    const hodRef = usersColl.doc(body.hodUid);
    const [hodSnap, allDeptsSnap] = await Promise.all([hodRef.get(), deptsColl.get()]);
    if (!hodSnap.exists || (hodSnap.data() as { role?: string } | undefined)?.role !== "HOD") {
      return NextResponse.json({ error: "HOD not found" }, { status: 404 });
    }
    const hodData = hodSnap.data() as { name?: string; department?: string; departments?: string[] };
    const allDepts = allDeptsSnap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as { name?: string; hodUid?: string; parentDepartmentId?: string }),
    }));

    const requestedIds = new Set(body.departmentIds);
    for (const id of requestedIds) {
      const dept = allDepts.find((d) => d.id === id);
      if (!dept) {
        return NextResponse.json({ error: "One of the selected departments no longer exists" }, { status: 400 });
      }
      if (dept.parentDepartmentId) {
        return NextResponse.json(
          { error: `"${dept.name}" is a sub-department and can't be assigned here - only top-level departments` },
          { status: 400 }
        );
      }
    }

    const currentNames = new Set(
      (hodData.departments && hodData.departments.length > 0 ? hodData.departments : [hodData.department ?? ""]).filter(
        (n): n is string => Boolean(n)
      )
    );
    const requestedDepts = allDepts.filter((d) => requestedIds.has(d.id));
    const requestedNames = new Set(requestedDepts.map((d) => d.name ?? ""));

    const now = new Date();
    const batch = db.batch();
    const displaced: { deptName: string; previousHodName: string }[] = [];

    // Newly checked: claim the department for this HOD, evicting whoever had it.
    for (const dept of requestedDepts) {
      if (currentNames.has(dept.name ?? "")) continue;
      if (dept.hodUid && dept.hodUid !== body.hodUid) {
        const prevRef = usersColl.doc(dept.hodUid);
        const prevSnap = await prevRef.get();
        const prevData = prevSnap.data() as { name?: string; department?: string; departments?: string[] } | undefined;
        if (prevData) {
          displaced.push({ deptName: dept.name ?? "", previousHodName: prevData.name ?? "" });
          const prevRemaining = (prevData.departments && prevData.departments.length > 0 ? prevData.departments : [prevData.department ?? ""]).filter(
            (n) => n && n !== dept.name
          );
          batch.update(prevRef, { department: prevRemaining[0] ?? "", departments: prevRemaining, updatedAt: now });
        }
      }
      batch.update(deptsColl.doc(dept.id), { hodUid: body.hodUid, hodName: hodData.name ?? "", updatedAt: now });
    }

    // Unchecked: release the department entirely (only if this HOD is still
    // the one actually holding it - avoids clobbering a hodUid someone else
    // already claimed through a different save in the meantime).
    for (const name of currentNames) {
      if (requestedNames.has(name)) continue;
      const dept = allDepts.find((d) => d.name === name);
      if (dept && dept.hodUid === body.hodUid) {
        batch.update(deptsColl.doc(dept.id), { hodUid: "", hodName: "", updatedAt: now });
      }
    }

    const finalNames = Array.from(requestedNames);
    batch.update(hodRef, { department: finalNames[0] ?? "", departments: finalNames, updatedAt: now });

    await batch.commit();

    await db.collection("colleges").doc(collegeId).collection("auditLogs").add({
      collegeId,
      action: "HOD_DEPARTMENTS_UPDATED",
      performedBy: session.uid,
      performedByName: session.role,
      targetId: body.hodUid,
      details: { departments: finalNames, displaced },
      timestamp: now,
    });

    return NextResponse.json({ ok: true, displaced });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/hod-departments PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
