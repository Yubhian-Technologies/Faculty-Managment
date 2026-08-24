export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import { syncDepartmentHod, getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { getCreatableOfficeRoles } from "@/lib/roles/officeRoles";
import type { CollegeType, UserRole } from "@/types";

// Base roles every college type can create; which "internal office" roles
// (Dean/IQAC/T&P/R&D/Placement/Library/Exam Cell/Webmaster) are also allowed
// depends on the college's type - see getCreatableOfficeRoles. Must match
// the same gating in principal/staff/new/page.tsx's CREATABLE_ROLES.
// COLLEGE_STAFF is intentionally omitted - non-teaching staff are created via
// the Supporting Staff module (which makes both a login and a profile record),
// not as a bare login here. See principal/staff/new/page.tsx for the rationale.
const PRINCIPAL_BASE_ROLES: UserRole[] = ["HOD", "COLLEGE_OFFICE", "COLLEGE_ADMIN", "VICE_PRINCIPAL", "COLLEGE_ACCOUNTS"];
// HOD is included so a main HOD can create a Sub-HOD login (see
// hod/settings/sub-departments/page.tsx's "Create Sub-HOD" dialog, which
// posts role: "HOD" with the not-yet-created sub-department's name as
// `department` - the sub-department itself, and this account's actual scope,
// only becomes real once POST /api/college/departments links them via
// hodUid, which is where the "only within your own department" check lives).
// CLASS_LEADER is included so an HOD can create their own sections' Class
// Leader logins from hod/sections/[id]/edit - the College Office pages that
// used to be the only place this happened were removed; this is where
// section management actually lives now.
const HOD_ROLES: UserRole[] = ["PANEL_MEMBER", "HOD", "CLASS_LEADER"];
// College Office may only create Class Leader logins - one per Section, bound
// via `sectionId` below. (The College Office section pages that used to call
// this were removed; sections are managed from the HOD and Principal views.)
const OFFICE_ROLES: UserRole[] = ["CLASS_LEADER"];
// One holder per role per college — same rule as administration/college-staff route.
const COLLEGE_SINGLETON_ROLES: UserRole[] = ["LIBRARY", "EXAM_CELL", "WEBMASTER", "COLLEGE_ACCOUNTS"];

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "WEBMASTER", "R_AND_D", "COLLEGE_OFFICE");
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

    // HOD sees only their own department(s)' users unless allDepts=true
    if (session.role === "HOD" && !allDepts) {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (scope.ownDepartmentNames.length > 0) {
        const ownSet = new Set(scope.ownDepartmentNames);
        users = users.filter((u) => ownSet.has((u as unknown as { department?: string }).department ?? ""));
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
      email?: string; // required for CLASS_LEADER; optional personal contact for everyone else
      collegeEmail?: string;
      employeeId?: string;
      phone?: string;
      password: string;
      role: UserRole;
      department?: string;
      staffType?: "teaching" | "supporting";
      designation?: string; // free-text title for COLLEGE_STAFF (e.g. "Dean - R&D")
      sectionId?: string; // required when role === "CLASS_LEADER" - the Section this login is bound to
      academicProfile?: Record<string, unknown>;
      profilePhotoUrl?: string;
      // yyyy-mm-dd - see FMSUser.dateOfJoining. Not required for CLASS_LEADER
      // (a rotating student-rep login, not a real staff hire).
      dateOfJoining?: string;
    } & PersonalDetailsInput;

    const { name, email, collegeEmail, password, role, department, academicProfile, profilePhotoUrl, designation, sectionId, dateOfJoining } = body;

    if (!password || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    // College email is the login username for every real staff hire (not a
    // Class Leader - a rotating student-rep login, which still requires its
    // own `email` instead) - same rule /api/college/faculty and
    // /api/college/supporting-staff already enforce. `email` here becomes
    // just an optional personal contact address for real staff.
    if (role === "CLASS_LEADER" && !email) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (role !== "CLASS_LEADER" && !collegeEmail) {
      return NextResponse.json({ error: "collegeEmail is required" }, { status: 400 });
    }
    if (role !== "CLASS_LEADER" && !name) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (dateOfJoining && Number.isNaN(new Date(dateOfJoining).getTime())) {
      return NextResponse.json({ error: "Invalid dateOfJoining" }, { status: 400 });
    }
    if (role === "CLASS_LEADER" && !sectionId) {
      return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    }
    // Uploaded before the account exists (under a temp id), so we can only check
    // it came from our own upload endpoint, not that it names this specific uid.
    if (profilePhotoUrl !== undefined && !profilePhotoUrl.startsWith("https://firebasestorage.googleapis.com/")) {
      return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
    }

    const collegeId = session.collegeId;
    const db = getAdminDb();

    // Enforce role-based creation rules - Vice Principal mirrors Principal's authority.
    if (session.role === "PRINCIPAL" || session.role === "VICE_PRINCIPAL") {
      const collegeSnap = await db.collection("colleges").doc(collegeId).get();
      const collegeType = (collegeSnap.data() as { type?: CollegeType } | undefined)?.type;
      // Placement Department is Administration-provisioned, not Principal-created.
      const principalRoles = [...PRINCIPAL_BASE_ROLES, ...getCreatableOfficeRoles(collegeType).filter((r) => r !== "PLACEMENT_DEPT")];
      if (!principalRoles.includes(role)) {
        return NextResponse.json(
          { error: `Principal can only create: ${principalRoles.join(", ")}` },
          { status: 403 }
        );
      }
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
      // An HOD may only create a Class Leader for a section in their own
      // department or one of their sub-departments - HOD_ROLES above only
      // gates the ROLE, not which section, so without this an HOD could
      // otherwise create a login for any section college-wide.
      if (session.role === "HOD") {
        const scope = await getHodDepartmentScope(db, collegeId, session.uid);
        if (!canHodEditDepartment(scope, sectionData.department ?? "")) {
          return NextResponse.json(
            { error: "That section is not in your department or one of your sub-departments" },
            { status: 403 }
          );
        }
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

    // For HOD: auto-assign their department if not provided - only safe when
    // they head exactly one; an HOD running two or more must say which one
    // this new login belongs to.
    let resolvedDepartment = department ?? "";
    if (session.role === "HOD" && !resolvedDepartment && role !== "CLASS_LEADER") {
      const scope = await getHodDepartmentScope(db, collegeId, session.uid);
      if (scope.ownDepartmentNames.length > 1) {
        return NextResponse.json(
          { error: "You manage more than one department - specify which department this account belongs to" },
          { status: 400 }
        );
      }
      resolvedDepartment = scope.ownDepartmentNames[0] ?? "";
    }
    // Class Leader: department/sectionName always come from the Section itself
    if (role === "CLASS_LEADER" && sectionData) {
      resolvedDepartment = sectionData.department ?? "";
    }

    // Class Leader logins aren't tied to one fixed student's identity - the
    // role can rotate (e.g. a boys' rep / girls' rep) per college rules - so
    // Office never enters a name; every such login gets this generic label.
    const resolvedName = role === "CLASS_LEADER" ? "Class Representative" : name!;

    // College email is the login username (and the canonical `email` field
    // below) for every real staff hire - the personal `email` input is kept
    // only as an optional contact address (`personalEmail`). A Class Leader
    // has no college email concept, so it keeps using its own `email` as before.
    const loginEmail = role === "CLASS_LEADER" ? email! : collegeEmail!;

    // Create Firebase Auth user via REST API (no firebase-admin/auth required)
    const uid = await createFirebaseUser(loginEmail, password, resolvedName);

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
        email: loginEmail,
        ...(role !== "CLASS_LEADER" ? { collegeEmail } : {}),
        ...(role !== "CLASS_LEADER" && email ? { personalEmail: email } : {}),
        ...(body.employeeId ? { employeeId: body.employeeId } : {}),
        ...(body.phone ? { phone: body.phone } : {}),
        role,
        department: resolvedDepartment,
        ...(dateOfJoining ? { dateOfJoining: new Date(dateOfJoining) } : {}),
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
      uid, role, collegeId, email: loginEmail, name: resolvedName,
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
