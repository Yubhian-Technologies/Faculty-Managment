export const dynamic = "force-dynamic";

import { convertLegacyAccounts } from "@/lib/roles/seats";
import { NextResponse } from "next/server";
import { requireCollegeMember, isDepartmentOffice } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import { syncDepartmentHod, getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { isSeatRole } from "@/lib/roles/seatRoles";
import { normalizeAcademicProfile } from "@/lib/faculty/academicProfileCompat";
import { degreeTypeError } from "@/lib/faculty/degreeType";
import { migrateUserDoc } from "@/lib/faculty/fieldRenames";
import type { UserRole } from "@/types";

// The only two roles that are genuinely just accounts, not seats. Every
// position of authority - College Admin, Academics, IQAC Coordinator, T&P, R&D,
// Placement Dept, Exam Cell, Library, HOD, Vice Principal - is a SEAT:
// create the person here with a plain login, then appoint them to the seat
// from Role Assignments (see types/roleSeats.ts). Must match the same list
// in principal/staff/new/page.tsx's CREATABLE_ROLES.
// COLLEGE_STAFF is intentionally omitted - non-teaching staff are created via
// the Supporting Staff module (which makes both a login and a profile record),
// not as a bare login here. See principal/staff/new/page.tsx for the rationale.
const PRINCIPAL_BASE_ROLES: UserRole[] = ["COLLEGE_OFFICE", "COLLEGE_ACCOUNTS"];
// CLASS_LEADER is included so an HOD can create their own sections' Class
// Leader logins from hod/sections/[id]/edit - the College Office pages that
// used to be the only place this happened were removed; this is where
// section management actually lives now.
// DEPARTMENT_OFFICE is the HOD's own office head for their department - see
// UserRole. Only a real HOD may create one (an office head is fenced out of it
// below), and only one per department.
const HOD_ROLES: UserRole[] = ["PANEL_MEMBER", "CLASS_LEADER", "DEPARTMENT_OFFICE"];
// College Office may only create Class Leader logins - one per Section, bound
// via `sectionId` below. (The College Office section pages that used to call
// this were removed; sections are managed from the HOD and Principal views.)
const OFFICE_ROLES: UserRole[] = ["CLASS_LEADER"];
// One holder per role per college. (Library/Exam Cell are seats now, singular
// by construction via isSingletonSeatRole - Webmaster and College Accounts
// are the only plain accounts left that still need this check here.)
const COLLEGE_SINGLETON_ROLES: UserRole[] = ["WEBMASTER", "COLLEGE_ACCOUNTS"];

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
    // A role filter also returns whoever holds a SEAT of that role (e.g. a
    // faculty member who is the current HOD - see types/roleSeats.ts), not just
    // accounts whose own primary role matches.
    let docs = snap.docs;
    if (roleFilter && isSeatRole(roleFilter)) {
      const seatHolders = await coll.where("seatRoles", "array-contains", roleFilter).get();
      const seen = new Set(docs.map((d) => d.id));
      docs = [...docs, ...seatHolders.docs.filter((d) => !seen.has(d.id))];
    }
    let users = docs
      .map((d) => ({ uid: d.id, ...migrateUserDoc(d.data()) }))
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
      designation?: string; // free-text title for COLLEGE_STAFF (e.g. "Academics - R&D")
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
    const degreeErr = degreeTypeError(academicProfile);
    if (degreeErr) return NextResponse.json({ error: degreeErr }, { status: 400 });
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
      if (!PRINCIPAL_BASE_ROLES.includes(role)) {
        return NextResponse.json(
          { error: `Principal can only create: ${PRINCIPAL_BASE_ROLES.join(", ")}` },
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

    // Appointing leadership stays with the actual HOD. A Department Office
    // head's session reads "HOD" everywhere (see api/auth/session), which is
    // exactly what gives them equal operational authority - so this is one of
    // the few places that has to look past that at the real role, or the
    // appointee could appoint (and thereby replace) themselves.
    if (role === "DEPARTMENT_OFFICE" && isDepartmentOffice(session)) {
      return NextResponse.json(
        { error: "Only the Head of Department can appoint a Department Office head" },
        { status: 403 }
      );
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

    // One Department Office head per DEPARTMENT (not per college, unlike
    // COLLEGE_SINGLETON_ROLES above) - checked here rather than beside those
    // because it needs the department resolved first. An HOD may also only
    // appoint one within their own scope, same rule every other HOD-created
    // login follows.
    if (role === "DEPARTMENT_OFFICE") {
      if (!resolvedDepartment) {
        return NextResponse.json({ error: "A department is required for a Department Office head" }, { status: 400 });
      }
      if (session.role === "HOD") {
        const scope = await getHodDepartmentScope(db, collegeId, session.uid);
        if (!canHodEditDepartment(scope, resolvedDepartment)) {
          return NextResponse.json({ error: "That department is not yours to appoint for" }, { status: 403 });
        }
      }
      const existingSnap = await db
        .collection("colleges").doc(collegeId).collection("users")
        .where("role", "==", "DEPARTMENT_OFFICE")
        .where("department", "==", resolvedDepartment)
        .limit(1).get();
      if (!existingSnap.empty) {
        const holder = existingSnap.docs[0].data() as { name?: string };
        return NextResponse.json(
          { error: `${resolvedDepartment} already has a Department Office head (${holder.name ?? "another user"}). Remove them first.` },
          { status: 409 }
        );
      }
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
        ...(academicProfile ? { academicProfile: normalizeAcademicProfile(academicProfile) } : {}),
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

    // Best-effort: the account already exists at this point, so a logging
    // failure must not surface as "Internal error" to the caller. `email`
    // (the optional personal contact address) is often absent, so log the
    // login email instead - a plain `email: email` here would be `undefined`
    // and Firestore rejects undefined field values, failing the whole request.
    try {
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
          details: { email: loginEmail, role, name: resolvedName, department: resolvedDepartment },
          timestamp: now,
        });
    } catch (auditErr) {
      console.error("[college/users POST] audit log write failed", auditErr);
    }

    // A new login with a seat role (Academics, IQAC, ...) also gets its seat, so the
    // seat list never lags behind the accounts (see lib/roles/seats.ts). Safe
    // to repeat - accounts that already hold a seat are skipped.
    await convertLegacyAccounts(db, session.collegeId, { uid: session.uid, name: session.email || "Unknown" })
      .catch((e) => console.error("[college/users POST] seat conversion failed:", e));

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
