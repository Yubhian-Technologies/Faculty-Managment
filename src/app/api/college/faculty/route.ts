export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import { getHodDepartmentScope, getDepartmentTreeNames, canHodEditDepartment, facultyManageableDepartmentNames } from "@/lib/departments/scope";
import { LEGACY_TECHNICAL_DESIGNATIONS } from "@/lib/designations/config";
import { experienceBreakdown, allPreviousExperienceEntries } from "@/lib/faculty/experienceCalc";
import { normalizeAcademicProfile } from "@/lib/faculty/academicProfileCompat";
import { degreeTypeError } from "@/lib/faculty/degreeType";
import { migrateFacultyDoc } from "@/lib/faculty/fieldRenames";
import { mobileNoFromBody } from "@/lib/faculty/mobileNo";
import { normalizeHighestQualification } from "@/lib/faculty/highestQualification";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import type { Designation, FacultyStatus, EmployeeCategory } from "@/types";
import { EMPLOYEE_CATEGORY_VALUES, EMPLOYEE_CATEGORY_ERROR_MESSAGE, SELECTABLE_FACULTY_STATUS_VALUES, FACULTY_STATUS_ERROR_MESSAGE, isFacultyAvailable } from "@/types";
import { loadDepartmentIndex, stampDepartmentIds } from "@/lib/departments/stampIds";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE", "PANEL_MEMBER", "COLLEGE_STAFF");
    const { searchParams } = new URL(request.url);
    const deptFilter = searchParams.get("department");
    const statusFilter = searchParams.get("status");
    // "Available for work" (ACTIVE or RETAINERSHIP) - used by every real
    // picker (Teaching Assignments, Sections' Faculty Incharge, Timetable,
    // etc.) instead of the old status=ACTIVE-only literal, so Retainership
    // faculty are offered everywhere Active ones are. Applied as a plain JS
    // filter on the already department/scope-narrowed result below, not a
    // second Firestore "in" clause - Firestore allows only one "in"/
    // "array-contains-any" per query, and department filtering below already
    // uses one (scope.ownDepartmentNames/relatedNames).
    const availableOnly = searchParams.get("availableOnly") === "true";
    // Opt-in for a plain HOD's own Faculty roster (see hod/faculty/page.tsx) -
    // a parent/managing HOD's sub-departments' faculty were showing up
    // unannounced in what reads as "my department's roster", confusing an
    // HOD who created someone under a different department into thinking it
    // landed in their own. Every other caller (Sections/Batches' Faculty
    // Incharge pickers, the Timetable grid, etc.) keeps the roll-up by not
    // passing this. A managed/"core" branch's faculty never appear here
    // regardless (see facultyManageableDepartmentNames below), so this only
    // ever narrows between "own department" and "own + true sub-departments".
    const ownOnly = searchParams.get("scope") === "own";

    const db = getAdminDb();
    const facultyColl = db.collection("colleges").doc(session.collegeId).collection("facultyMembers");
    const withStatus = (q: FirebaseFirestore.Query): FirebaseFirestore.Query =>
      statusFilter ? q.where("status", "==", statusFilter) : q;

    let primaryQuery: FirebaseFirestore.Query = facultyColl;
    // A parent department's HOD manages its sub-departments' faculty too, so
    // they are listed alongside their own - needed both to pick a sub-department
    // specialist when assigning a shared/parent-owned subject, and to administer
    // those faculty directly (see canHodEditDepartment in lib/departments/scope).
    let childDeptQuery: FirebaseFirestore.Query | null = null;

    // Deliberately does NOT cross into a feeder/fed department's own faculty
    // (e.g. Basic Science's faculty showing up under CSE, or vice versa) -
    // that used to be included view-only via secondaryDepartments, but a
    // department's faculty register only ever shows faculty who actually
    // belong to that department (or a sub-department/managed branch it fully
    // owns).
    if (session.role === "HOD") {
      // A `department` param means a caller already knows exactly which
      // department it needs (a picker - e.g. hod/timetable's Assign
      // Timetable Incharge dialog, or TeachingAssignmentsEditor staffing a
      // subject - both filter/trust the result down to that one department
      // themselves). Use the HOD's FULL scope there (activeOnly: false), not
      // just whichever department happens to be active in the Working-as
      // switcher - otherwise the picker silently comes back empty for a
      // department the HOD legitimately manages but isn't "working as" right
      // now. The ambient roster (no `department` param, e.g. hod/faculty)
      // keeps the Working-as narrowing so switching context actually
      // isolates that view, as intended.
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid, { activeOnly: !deptFilter });
      if (scope.ownDepartmentNames.length > 0) {
        primaryQuery = primaryQuery.where("department", "in", scope.ownDepartmentNames.slice(0, 30));
      } else {
      // An HOD with no department on file must see nothing - not the whole
      // college, which is what leaving the query unfiltered would return.
        primaryQuery = primaryQuery.where("department", "==", "__none__");
      }

      // Sub-departments only (facultyManageableDepartmentNames) - a managed/
      // "core" branch's own faculty roster is never this HOD's, sub-HOD or
      // main HOD alike (see its own doc-comment in lib/departments/scope.ts),
      // so `excludeManaged` has nothing left to do here; kept as a no-op for
      // any existing caller still passing it. Skipped entirely for the
      // own-only roster (see ownOnly above).
      const ownedNames = ownOnly
        ? []
        : facultyManageableDepartmentNames(scope).filter((n) => !scope.ownDepartmentNames.includes(n));
      if (ownedNames.length > 0) {
        childDeptQuery = withStatus(facultyColl.where("department", "in", ownedNames.slice(0, 30)));
      }
    } else if (session.role === "PANEL_MEMBER" || session.role === "COLLEGE_STAFF") {
      // A Timetable Incharge (see TimetableIncharge in src/types/core.ts) -
      // whether teaching faculty or supporting staff - fetching their
      // delegated department's own faculty roster to assign subjects to.
      // Restricted to their OWN department only, never an arbitrary one -
      // this role list previously had no access to this route at all. No
      // `department` param (e.g. TimetableGridEditor's own unfiltered "which
      // faculty count as mine" check) defaults to their own department
      // rather than 400ing - an explicit DIFFERENT department is still
      // rejected below.
      const callerSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      const callerDepartment = (callerSnap.data() as { department?: string } | undefined)?.department;
      if (!callerDepartment || (deptFilter && callerDepartment !== deptFilter)) {
        return NextResponse.json({ error: "You can only view your own department's faculty" }, { status: 403 });
      }
      primaryQuery = primaryQuery.where("department", "==", callerDepartment);
    } else if (deptFilter) {
      // Office/Principal/VP picking faculty for a specific department (e.g.
      // a section's Faculty Incharge) also see faculty registered under that
      // department's parent or sub-departments - a sub-department's own
      // faculty pool is often thin, and the main HOD's faculty may teach
      // there too.
      const relatedNames = await getDepartmentTreeNames(db, session.collegeId, deptFilter);
      primaryQuery = relatedNames.length > 1
        ? primaryQuery.where("department", "in", relatedNames)
        : primaryQuery.where("department", "==", deptFilter);
    }

    primaryQuery = withStatus(primaryQuery);

    const [primarySnap, childDeptSnap] = await Promise.all([
      primaryQuery.get(),
      childDeptQuery ? childDeptQuery.get() : Promise.resolve(null),
    ]);

    const faculty: { id: string; accessLevel: "primary"; [key: string]: unknown }[] =
      primarySnap.docs.map((d) => ({ id: d.id, ...migrateFacultyDoc(d.data()), accessLevel: "primary" }));
    if (childDeptSnap) {
      // "primary": for an HOD this query holds their own sub-departments'
      // faculty, which they fully manage (canHodEditDepartment), so the UI
      // must not mark them view-only.
      for (const d of childDeptSnap.docs) {
        faculty.push({ id: d.id, ...migrateFacultyDoc(d.data()), accessLevel: "primary" });
      }
    }
    // Technical designations belong to Supporting Staff now (see
    // LEGACY_TECHNICAL_DESIGNATIONS) - excluded here rather than at query time
    // (Firestore only allows one inequality filter per query, already spent on
    // department/status) so the Faculty Register stays teaching-only even for
    // any pre-migration record still sitting in facultyMembers.
    let teachingOnly = faculty.filter((f) => !LEGACY_TECHNICAL_DESIGNATIONS.includes(f.designation as string));
    if (availableOnly) teachingOnly = teachingOnly.filter((f) => isFacultyAvailable(f.status as string));

    teachingOnly.sort((a, b) =>
      facultyDisplayName(a as { legalName?: string }).localeCompare(
        facultyDisplayName(b as { legalName?: string })
      )
    );
    return NextResponse.json({ faculty: teachingOnly });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");

    const body = (await request.json()) as {
      employeeId: string;
      apaarFacultyId?: string;
      email?: string;
      collegeEmail: string;
      password: string;
      mobileNo?: string;
      phone?: string; // legacy alias of mobileNo, accepted for one release (see mobileNoFromBody)
      additionalPhoneNumbers?: { label?: string; number: string }[];
      designation: Designation;
      employeeCategory: EmployeeCategory;
      highestQualification: string;
      specialization?: string;
      joiningDate: string;
      aicteFacultyId?: string;
      department?: string;
      status?: FacultyStatus;
      academicProfile?: Record<string, unknown>;
      technicalProfile?: Record<string, unknown>;
      profilePhotoUrl?: string;
    } & PersonalDetailsInput;

    const {
      employeeId,
      collegeEmail,
      password,
      designation,
      employeeCategory,
      highestQualification,
      joiningDate,
      profilePhotoUrl,
    } = body;

    if (!employeeId || !collegeEmail || !password || !designation || !highestQualification || !joiningDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    // Only the EMPLOYEE_CATEGORY_VALUES keys are accepted anywhere Employee
    // Category is set - enforced here, not just in the Add Faculty dropdown.
    if (!EMPLOYEE_CATEGORY_VALUES.includes(employeeCategory)) {
      return NextResponse.json({ error: EMPLOYEE_CATEGORY_ERROR_MESSAGE }, { status: 400 });
    }
    // Status is selectable on the Add Faculty wizard (defaults to ACTIVE when
    // not sent, e.g. any external caller) - INTERVIEW_DONE is deliberately
    // excluded, that's system-managed only (see SELECTABLE_FACULTY_STATUS_VALUES).
    const status: FacultyStatus = body.status ?? "ACTIVE";
    if (!(SELECTABLE_FACULTY_STATUS_VALUES as string[]).includes(status)) {
      return NextResponse.json({ error: FACULTY_STATUS_ERROR_MESSAGE }, { status: 400 });
    }
    const degreeErr = degreeTypeError(body.academicProfile);
    if (degreeErr) return NextResponse.json({ error: degreeErr }, { status: 400 });
    // Matches the mandatory field set the bulk-import template and Add
    // Faculty wizard's Personal Details step now both enforce. Name (as per
    // PAN) is deliberately NOT required here - Full Name (as per SSC)
    // (legalName) is the faculty member's only identity/display name; Name (as
    // per PAN) (nameAsPerPan) is optional statutory detail, independent of it.
    if (!mobileNoFromBody(body) || !body.legalName || !body.gender || !body.dateOfBirth || !body.aadharNo || !body.panNo || !body.ratificationStatus) {
      return NextResponse.json({ error: "Missing required personal details - Mobile No, Full Name (as per SSC), Gender, Date of Birth, Aadhar No, PAN No, and Ratification Status are all required" }, { status: 400 });
    }
    // The name used everywhere this record is displayed/copied from (login
    // account, teaching assignments, sections, etc.) - Full Name (as per SSC)
    // is the only identity/display name (required above).
    const finalName = body.legalName.trim();
    // Uploaded before the record exists (under a temp id), so we can only check
    // it came from our own upload endpoint, not that it names this specific id.
    if (profilePhotoUrl !== undefined && !profilePhotoUrl.startsWith("https://firebasestorage.googleapis.com/")) {
      return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;

    // Resolve the owning department. A parent HOD may add faculty straight into
    // one of their sub-departments by naming it; anything else falls back to
    // their own department. A sub-HOD has no children, so they always land on
    // their own either way.
    let department = body.department ?? "";
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, collegeId, session.uid);
      const requested = body.department?.trim();
      if (requested && !canHodEditDepartment(scope, requested)) {
        return NextResponse.json(
          { error: "That department is not yours or one of your sub-departments" },
          { status: 403 },
        );
      }
      if (!requested && scope.ownDepartmentNames.length > 1) {
        return NextResponse.json(
          { error: "You manage more than one department - specify which department this faculty member belongs to" },
          { status: 400 },
        );
      }
      department = requested || scope.ownDepartmentNames[0] || "";
    } else if (!department) {
      const hodSnap = await db
        .collection("colleges")
        .doc(collegeId)
        .collection("users")
        .doc(session.uid)
        .get();
      department = (hodSnap.data() as { department?: string } | undefined)?.department ?? department;
    }

    // Check employee ID uniqueness across every college, not just this one -
    // the public faculty-profile link is keyed on employeeId alone (see
    // /api/public/faculty-public), so a collision between colleges would let
    // one person's link resolve to a different person's profile.
    const existing = await db
      .collectionGroup("facultyMembers")
      .where("employeeId", "==", employeeId)
      .limit(1)
      .get();

    if (!existing.empty) {
      return NextResponse.json({ error: "Employee ID already exists" }, { status: 409 });
    }

    // College email is the login username - create the Firebase Auth user with it,
    // not the personal email (which is optional, contact-only). Uses
    // finalName (legalName), so the Auth account's display name is never blank.
    const uid = await createFirebaseUser(collegeEmail, password, finalName);

    const now = new Date();

    // Write to users collection (login account) - name here is finalName too
    // (legalName), since this is what nav/notifications/pickers
    // read as "the" display name for this login.
    await db
      .collection("colleges")
      .doc(collegeId)
      .collection("users")
      .doc(uid)
      .set({
        uid,
        collegeId,
        name: finalName,
        email: collegeEmail,
        role: "PANEL_MEMBER",
        department,
        ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

    // Write faculty member record
    const docRef = db
      .collection("colleges")
      .doc(collegeId)
      .collection("facultyMembers")
      .doc();

    const deptIndex = await loadDepartmentIndex(db, collegeId);
    await docRef.set(stampDepartmentIds({
      collegeId,
      department,
      employeeId,
      ...(body.apaarFacultyId ? { apaarFacultyId: body.apaarFacultyId } : {}),
      // Name (as per PAN) is written by buildPersonalDetailsUpdate below
      // (nameAsPerPan), only when given. "The" display name is legalName - see
      // finalName above and facultyDisplayName() (src/lib/faculty/facultyDisplayName.ts).
      collegeEmail,
      ...(body.email ? { email: body.email } : {}),
      mobileNo: mobileNoFromBody(body) ?? "",
      // Firestore has no ignoreUndefinedProperties, so a wholly-empty list
      // (or one with only blank rows) is left out entirely rather than
      // written as [] - see the mobileNo/apaarFacultyId pattern above.
      ...((() => {
        const numbers = (body.additionalPhoneNumbers ?? [])
          .map((p) => ({ ...(p.label?.trim() ? { label: p.label.trim() } : {}), number: p.number?.trim() ?? "" }))
          .filter((p) => p.number);
        return numbers.length > 0 ? { additionalPhoneNumbers: numbers } : {};
      })()),
      designation,
      employeeCategory,
      highestQualification: normalizeHighestQualification(highestQualification),
      specialization: body.specialization ?? "",
      // Total Years of Experience (Internal since Date of Joining + External
      // from the Academic/Industry/Research Experience entries) - computed
      // here server-side rather than trusted from the client, same as PATCH
      // /api/college/faculty/[id], so it can't drift from what Faculty
      // Details/the Faculty List compute live from the same two inputs.
      totalYearsOfExperience: experienceBreakdown(
        allPreviousExperienceEntries(body.academicProfile as Parameters<typeof allPreviousExperienceEntries>[0]),
        new Date(joiningDate)
      ).total,
      joiningDate: new Date(joiningDate),
      ...(body.aicteFacultyId?.trim() ? { aicteFacultyId: body.aicteFacultyId.trim() } : {}),
      status,
      userUid: uid,
      ...(body.academicProfile ? { academicProfile: normalizeAcademicProfile(body.academicProfile) } : {}),
      ...(body.technicalProfile ? { technicalProfile: body.technicalProfile } : {}),
      ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
      ...buildPersonalDetailsUpdate(body),
      createdAt: now,
      updatedAt: now,
    }, deptIndex));

    // Role mapping for Firestore-based session resolution
    await db.collection("systemUsers").doc(uid).set({
      uid, role: "PANEL_MEMBER", collegeId, email: collegeEmail, name: finalName,
      ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
    });

    return NextResponse.json({ id: docRef.id, uid }, { status: 201 });
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
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    console.error("[college/faculty POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
