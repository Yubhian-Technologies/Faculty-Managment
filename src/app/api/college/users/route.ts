export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import { syncDepartmentHod } from "@/lib/departments/scope";
import type { UserRole } from "@/types";

const PRINCIPAL_ROLES: UserRole[] = ["HOD", "COLLEGE_OFFICE", "VICE_PRINCIPAL", "COLLEGE_STAFF", "PLACEMENT_DEPT", "LIBRARY", "EXAM_CELL", "WEBMASTER"];
// HOD is included so a main HOD can create a Sub-HOD login (see
// hod/settings/sub-departments/page.tsx's "Create Sub-HOD" dialog, which
// posts role: "HOD" with the not-yet-created sub-department's name as
// `department` - the sub-department itself, and this account's actual scope,
// only becomes real once POST /api/college/departments links them via
// hodUid, which is where the "only within your own department" check lives).
const HOD_ROLES: UserRole[] = ["PANEL_MEMBER", "HOD"];
// College Office may only create Class Leader logins - one per Section, bound
// via `sectionId` below (see college-office/sections/new and .../[id]/edit).
const OFFICE_ROLES: UserRole[] = ["CLASS_LEADER"];
// One holder per role per college - same rule as administration/college-staff route.
const COLLEGE_SINGLETON_ROLES: UserRole[] = ["PLACEMENT_DEPT", "LIBRARY", "EXAM_CELL", "WEBMASTER"];

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "WEBMASTER");
    const { searchParams } = new URL(request.url);
    const roleFilter = searchParams.get("role");
    const allDepts = searchParams.get("allDepts") === "true";

    const db = getAdminDb();
    const coll = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("users");

    const q = roleFilter
      ? coll.where("role", "==", roleFilter)
      : coll;

    const includeAll = searchParams.get("includeAll") === "true";

    const snap = await q.get();
    let users = snap.docs
      .map((d) => ({ uid: d.id, ...d.data() }))
      .filter((u) => includeAll || (u as unknown as { role: string }).role !== "PRINCIPAL")
      .sort((a, b) => {
        const an = (a as unknown as { name?: string }).name ?? "";
        const bn = (b as unknown as { name?: string }).name ?? "";
        return an.localeCompare(bn);
      });

    // A college has exactly one Principal - deduplicate to avoid showing test duplicates
    if (includeAll) {
      let principalSeen = false;
      users = users.filter((u) => {
        if ((u as unknown as { role: string }).role === "PRINCIPAL") {
          if (principalSeen) return false;
          principalSeen = true;
        }
        return true;
      });
    }

    // HOD sees only their department's users unless allDepts=true
    if (session.role === "HOD" && !allDepts) {
      const hodSnap = await db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("users")
        .doc(session.uid)
        .get();
      const hodDept = (hodSnap.data() as { department?: string } | undefined)?.department ?? "";
      if (hodDept) {
        users = users.filter((u) => (u as unknown as { department?: string }).department === hodDept);
      }
    }

    return NextResponse.json({ users });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/users GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "COLLEGE_OFFICE");

    const body = (await request.json()) as {
      name?: string; // not required for CLASS_LEADER - auto-generated below (role rotates by college rules)
      email: string;
      collegeEmail?: string;
      employeeId?: string;
      password: string;
      role: UserRole;
      department?: string;
      staffType?: "teaching" | "supporting";
      designation?: string; // free-text title for COLLEGE_STAFF (e.g. "Dean - R&D")
      sectionId?: string; // required when role === "CLASS_LEADER" - the Section this login is bound to
      academicProfile?: Record<string, unknown>;
      profilePhotoUrl?: string;
    } & PersonalDetailsInput;

    const { name, email, password, role, department, academicProfile, profilePhotoUrl, designation, sectionId } = body;

    if (!email || !password || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (role !== "CLASS_LEADER" && !name) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (role === "CLASS_LEADER" && !sectionId) {
      return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    }
    // Uploaded before the account exists (under a temp id), so we can only check
    // it came from our own upload endpoint, not that it names this specific uid.
    if (profilePhotoUrl !== undefined && !profilePhotoUrl.startsWith("https://firebasestorage.googleapis.com/")) {
      return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
    }

    // Enforce role-based creation rules - Vice Principal mirrors Principal's authority.
    if ((session.role === "PRINCIPAL" || session.role === "VICE_PRINCIPAL") && !PRINCIPAL_ROLES.includes(role)) {
      return NextResponse.json(
        { error: `Principal can only create: ${PRINCIPAL_ROLES.join(", ")}` },
        { status: 403 }
      );
    }
    if (session.role === "HOD" && !HOD_ROLES.includes(role)) {
      return NextResponse.json(
        { error: `HOD can only create: ${HOD_ROLES.join(", ")}` },
        { status: 403 }
      );
    }
    if (session.role === "COLLEGE_OFFICE" && !OFFICE_ROLES.includes(role)) {
      return NextResponse.json(
        { error: `College Office can only create: ${OFFICE_ROLES.join(", ")}` },
        { status: 403 }
      );
    }

    const collegeId = session.collegeId;
    const db = getAdminDb();

    // Class Leader: resolve + validate the target Section, derive
    // department/sectionName from it (never trust the client), and enforce
    // one class leader per section.
    let sectionRef: FirebaseFirestore.DocumentReference | null = null;
    let sectionData: { department?: string; name?: string; classLeaderUid?: string } | null = null;
    if (role === "CLASS_LEADER") {
      sectionRef = db.collection("colleges").doc(collegeId).collection("sections").doc(sectionId!);
      const sectionSnap = await sectionRef.get();
      if (!sectionSnap.exists) {
        return NextResponse.json({ error: "Section not found" }, { status: 404 });
      }
      sectionData = sectionSnap.data() as { department?: string; name?: string; classLeaderUid?: string };
      if (sectionData.classLeaderUid) {
        return NextResponse.json(
          { error: "This section already has a Class Leader login. Remove it first to create a new one." },
          { status: 409 }
        );
      }
    }

    // Enforce one holder per role per college for Office/Placement Dept/Library/Exam Cell
    if (COLLEGE_SINGLETON_ROLES.includes(role)) {
      const existingSnap = await db
        .collection("colleges").doc(collegeId).collection("users")
        .where("role", "==", role).limit(1).get();
      if (!existingSnap.empty) {
        const holder = existingSnap.docs[0].data() as { name?: string };
        return NextResponse.json(
          { error: `${role} is already assigned to ${holder.name ?? "another user"} for this college. Only one person can hold this role.` },
          { status: 409 }
        );
      }
    }

    // For HOD: auto-assign their department if not provided
    let resolvedDepartment = department ?? "";
    if (session.role === "HOD" && !resolvedDepartment) {
      const hodSnap = await db
        .collection("colleges")
        .doc(collegeId)
        .collection("users")
        .doc(session.uid)
        .get();
      resolvedDepartment = (hodSnap.data() as { department?: string } | undefined)?.department ?? "";
    }
    // Class Leader: department/sectionName always come from the Section itself
    if (role === "CLASS_LEADER" && sectionData) {
      resolvedDepartment = sectionData.department ?? "";
    }

    // Class Leader logins aren't tied to one fixed student's identity - the
    // role can rotate (e.g. a boys' rep / girls' rep) per college rules - so
    // Office never enters a name; every such login gets this generic label.
    const resolvedName = role === "CLASS_LEADER" ? "Class Representative" : name!;

    // Create Firebase Auth user via REST API (no firebase-admin/auth required)
    const uid = await createFirebaseUser(email, password, resolvedName);

    const now = new Date();
    await db
      .collection("colleges")
      .doc(collegeId)
      .collection("users")
      .doc(uid)
      .set({
        uid,
        collegeId,
        name: resolvedName,
        email,
        ...(body.collegeEmail ? { collegeEmail: body.collegeEmail } : {}),
        ...(body.employeeId ? { employeeId: body.employeeId } : {}),
        role,
        department: resolvedDepartment,
        ...(body.staffType ? { staffType: body.staffType } : {}),
        ...(designation ? { designation } : {}),
        ...(role === "CLASS_LEADER" ? { sectionId, sectionName: sectionData?.name ?? "" } : {}),
        ...(academicProfile ? { academicProfile } : {}),
        ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
        ...buildPersonalDetailsUpdate(body),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

    // Role mapping for Firestore-based session resolution
    await db.collection("systemUsers").doc(uid).set({
      uid, role, collegeId, email, name: resolvedName,
      ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
    });

    await syncDepartmentHod(db, collegeId, { uid, role, name: resolvedName, department: resolvedDepartment });

    // Link the login back onto its Section so office/HOD timetable-adjacent
    // views can show who the class leader is without a reverse lookup.
    if (role === "CLASS_LEADER" && sectionRef) {
      await sectionRef.update({ classLeaderUid: uid, classLeaderName: resolvedName, updatedAt: now });
    }

    // Audit log
    let creatorName = "Unknown";
    try {
      const creatorSnap = await db.collection("colleges").doc(collegeId).collection("users").doc(session.uid).get();
      creatorName = (creatorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    } catch { /* best-effort */ }

    await db
      .collection("colleges")
      .doc(collegeId)
      .collection("auditLogs")
      .add({
        collegeId,
        action: "USER_CREATED",
        performedBy: session.uid,
        performedByName: creatorName,
        targetId: uid,
        details: { email, role, name: resolvedName, department: resolvedDepartment },
        timestamp: now,
      });

    return NextResponse.json({ uid }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "auth/email-already-exists"
    ) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }
    console.error("[college/users POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
