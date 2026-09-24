export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember, isDepartmentOffice } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { forgetHeldRoles } from "@/lib/auth/liveRoles";

/**
 * Appointing one of the department's OWN faculty as its office head, and
 * standing them back down again.
 *
 * The post used to mean a separate login created from scratch, with its own
 * college email and temporary password (`role: "DEPARTMENT_OFFICE"`, see
 * /api/college/users POST). It is now a hat an existing faculty member wears:
 * the seat is recorded as "DEPARTMENT_OFFICE" in their own account's
 * `seatRoles`, exactly as an HOD's seat is recorded on the faculty member who
 * holds it.
 *
 * Nothing downstream needed teaching to understand that:
 *   - `orderHeldRoles` already maps a stored DEPARTMENT_OFFICE to HOD, so the
 *     appointee's held roles become ["HOD", "PANEL_MEMBER"] - every HOD module
 *     for this department, and their own faculty work still beside it.
 *   - `resolveHeldRoles` re-reads `seatRoles` on every guarded request, so
 *     standing someone down takes effect within the cache window rather than
 *     when their cookie expires.
 *   - api/auth/session sets `realRole` from the seat, which is what keeps an
 *     office head from appointing (and so replacing) another one.
 *
 * Deliberately NOT built on the roleSeats collection: those seats are the
 * Principal's to fill from Role Assignments, and this one is the HOD's alone.
 *
 * Accounts appointed the old way still work and are still listed and removed
 * by the page - see the DELETE branch.
 */

const SEAT = "DEPARTMENT_OFFICE";

// The HOD's own department, and the fact that they are a real HOD rather than
// the office head they appointed. Both checks are the same ones
// /api/college/users POST makes for the account-creating path this replaces.
async function hodContext() {
  const session = await requireCollegeMember("HOD");
  if (isDepartmentOffice(session)) {
    return { error: "Only the Head of Department can appoint a Department Office head", status: 403 as const };
  }
  const db = getAdminDb();
  const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
  if (scope.ownDepartmentNames.length > 1) {
    return {
      error: "You manage more than one department - switch to the one you are appointing for first",
      status: 400 as const,
    };
  }
  const department = scope.ownDepartmentNames[0] ?? "";
  if (!department) return { error: "You do not head a department", status: 403 as const };
  return { session, db, scope, department };
}

// Whoever currently holds the post for `department` - either a faculty member
// carrying the seat, or a standalone login from before this was a seat.
async function currentHolder(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  department: string
): Promise<{ uid: string; name: string } | null> {
  const users = db.collection("colleges").doc(collegeId).collection("users");
  const [seated, legacy] = await Promise.all([
    users.where("seatRoles", "array-contains", SEAT).get(),
    users.where("role", "==", SEAT).where("department", "==", department).get(),
  ]);
  const match =
    seated.docs.find((d) => {
      const u = d.data() as { department?: string; isActive?: boolean };
      return u.department === department && u.isActive !== false;
    }) ?? legacy.docs.find((d) => (d.data() as { isActive?: boolean }).isActive !== false);
  if (!match) return null;
  return { uid: match.id, name: (match.data() as { name?: string }).name ?? "Unknown" };
}

async function writeAudit(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  actorUid: string,
  action: string,
  targetId: string,
  details: Record<string, unknown>
) {
  // Best-effort, same as every other write in this area: the appointment has
  // already happened by this point and a logging failure must not read to the
  // caller as though it had not.
  try {
    let actorName = "Unknown";
    const actorSnap = await db.collection("colleges").doc(collegeId).collection("users").doc(actorUid).get();
    actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    await db.collection("colleges").doc(collegeId).collection("auditLogs").add({
      collegeId,
      action,
      performedBy: actorUid,
      performedByName: actorName,
      targetId,
      details,
      timestamp: new Date(),
    });
  } catch (auditErr) {
    console.error("[college/department-office] audit log write failed", auditErr);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await hodContext();
    if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { session, db, scope, department } = ctx;

    const { uid } = (await request.json()) as { uid?: string };
    if (!uid) return NextResponse.json({ error: "Pick a faculty member" }, { status: 400 });

    const users = db.collection("colleges").doc(session.collegeId).collection("users");
    const targetSnap = await users.doc(uid).get();
    if (!targetSnap.exists) return NextResponse.json({ error: "That person was not found in this college" }, { status: 404 });
    const target = targetSnap.data() as {
      name?: string; role?: string; department?: string; seatRoles?: string[]; isActive?: boolean;
    };

    if (target.isActive === false) {
      return NextResponse.json({ error: "That account is inactive" }, { status: 400 });
    }
    // Teaching faculty only. The post carries this department's full HOD
    // authority, and supporting staff / office logins are not in that line -
    // the same rule FACULTY_ONLY_SEAT_ROLES applies to the HOD seat itself.
    if (target.role !== "PANEL_MEMBER") {
      return NextResponse.json(
        { error: "Only a teaching faculty member can be the Department Office head" },
        { status: 400 }
      );
    }
    if (!canHodEditDepartment(scope, target.department ?? "")) {
      return NextResponse.json({ error: "That person is not in your department" }, { status: 403 });
    }
    if ((target.seatRoles ?? []).includes(SEAT)) {
      return NextResponse.json({ error: `${target.name ?? "They"} already holds this post` }, { status: 409 });
    }

    const holder = await currentHolder(db, session.collegeId, department);
    if (holder) {
      return NextResponse.json(
        { error: `${department} already has a Department Office head (${holder.name}). Remove them first.` },
        { status: 409 }
      );
    }

    await users.doc(uid).update({ seatRoles: FieldValue.arrayUnion(SEAT), updatedAt: new Date() });
    // So their very next request sees the new authority instead of waiting out
    // the held-roles cache.
    forgetHeldRoles(session.collegeId, uid);
    await writeAudit(db, session.collegeId, session.uid, "DEPARTMENT_OFFICE_APPOINTED", uid, {
      name: target.name ?? "", department,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/department-office POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await hodContext();
    if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { session, db, department } = ctx;

    const { uid } = (await request.json()) as { uid?: string };
    if (!uid) return NextResponse.json({ error: "Nobody to remove" }, { status: 400 });

    const users = db.collection("colleges").doc(session.collegeId).collection("users");
    const targetSnap = await users.doc(uid).get();
    if (!targetSnap.exists) return NextResponse.json({ error: "That person was not found in this college" }, { status: 404 });
    const target = targetSnap.data() as { name?: string; role?: string; department?: string; seatRoles?: string[] };

    if (target.department !== department) {
      return NextResponse.json({ error: "That Department Office head is not in your department" }, { status: 403 });
    }

    if ((target.seatRoles ?? []).includes(SEAT)) {
      // A faculty member standing down: take the hat away and leave the person
      // alone. Deactivating the account here would lock a working teaching
      // faculty member out of the system entirely.
      await users.doc(uid).update({ seatRoles: FieldValue.arrayRemove(SEAT), updatedAt: new Date() });
    } else if (target.role === SEAT) {
      // A standalone login from before the post was a seat. It IS the role, so
      // there is no hat to remove - it is deactivated instead, exactly as this
      // page has always done. Never deleted: it is referenced by whatever they
      // approved or recorded while in post.
      await users.doc(uid).update({ isActive: false, updatedAt: new Date() });
    } else {
      return NextResponse.json({ error: "They are not the Department Office head" }, { status: 400 });
    }

    forgetHeldRoles(session.collegeId, uid);
    await writeAudit(db, session.collegeId, session.uid, "DEPARTMENT_OFFICE_REMOVED", uid, {
      name: target.name ?? "", department,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/department-office DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
