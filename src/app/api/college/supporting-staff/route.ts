export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { SUPPORTING_STAFF_ROLE_CATEGORY, canRolePostCategory, supportingStaffCategoryLabel } from "@/lib/supportingStaff/roleCategory";
import { hasSupportingStaffSplit } from "@/lib/designations/config";
import { normalizeSupportingStaffProfile } from "@/lib/faculty/academicProfileCompat";
import { migrateSupportingStaffDoc } from "@/lib/faculty/fieldRenames";
import { experienceBreakdown } from "@/lib/faculty/experienceCalc";
import { supportingStaffDisplayName } from "@/lib/supportingStaff/supportingStaffDisplayName";
import { NON_TECHNICAL_STAFF_DESIGNATION_LABELS, ROLE_LABELS } from "@/types";
import type {
  SupportingStaffCategory, SupportingStaffDesignation, FacultyStatus, CollegeType,
} from "@/types";

function designationLabel(designation: SupportingStaffDesignation): string {
  return (NON_TECHNICAL_STAFF_DESIGNATION_LABELS as Record<string, string>)[designation] ?? designation;
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("SUPER_ADMIN", "COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL", "HOD");
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get("status");
    const categoryFilter = SUPPORTING_STAFF_ROLE_CATEGORY[session.role] ?? searchParams.get("staffCategory");
    // Opt-in for a plain HOD's own Supporting Staff roster - mirrors
    // scope=own on college/faculty/route.ts. Without it, a parent/managing
    // HOD's sub-departments'/managed branches' staff roll up alongside their
    // own, which reads as "another department's staff leaking into mine".
    const ownOnly = searchParams.get("scope") === "own";
    // A specific department (e.g. hod/timetable's Assign Timetable Incharge
    // dialog, picking Technical staff for one exact course-year's
    // department) - see the matching `department` handling in
    // college/faculty/route.ts for why this needs the HOD's FULL scope
    // rather than whichever department is active in the Working-as switcher.
    const deptFilter = searchParams.get("department");

    const db = getAdminDb();
    const staffColl = db.collection("colleges").doc(session.collegeId).collection("supportingStaff");

    let query: FirebaseFirestore.Query = staffColl;

    if (categoryFilter) query = query.where("staffCategory", "==", categoryFilter);
    if (statusFilter) query = query.where("status", "==", statusFilter);

    // HOD only sees Technical staff within their own department (plus any
    // sub-departments/managed branches they own, unless ownOnly) - mirrors
    // the scoping src/app/api/college/faculty/route.ts applies for HOD's
    // Faculty view.
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid, { activeOnly: !deptFilter });
      const ownedNames = ownOnly
        ? scope.ownDepartmentNames
        : [...scope.ownDepartmentNames, ...scope.childDepartmentNames, ...scope.managedDepartmentNames];
      if (deptFilter) {
        if (!ownedNames.includes(deptFilter)) {
          return NextResponse.json({ error: "That department isn't yours to manage" }, { status: 403 });
        }
        query = query.where("department", "==", deptFilter);
      } else if (ownedNames.length > 0) {
        query = query.where("department", "in", ownedNames.slice(0, 30));
      }
    }

    const snap = await query.get();
    const staff = snap.docs
      .map((d) => ({ id: d.id, ...migrateSupportingStaffDoc(d.data()) }))
      .sort((a, b) => {
        const s = a as { legalName?: string; nameAsPerPan?: string };
        const t = b as { legalName?: string; nameAsPerPan?: string };
        return supportingStaffDisplayName(s).localeCompare(supportingStaffDisplayName(t));
      });

    return NextResponse.json({ staff });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/supporting-staff GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE", "HOD", "PRINCIPAL", "VICE_PRINCIPAL");

    const body = (await request.json()) as {
      employeeId: string;
      apaarFacultyId?: string;
      email?: string;
      collegeEmail: string;
      password: string;
      mobileNo?: string;
      additionalPhoneNumbers?: { label?: string; number: string }[];
      staffCategory: SupportingStaffCategory;
      designation: SupportingStaffDesignation;
      otherDesignationTitle?: string;
      highestQualification: string;
      joiningDate: string;
      department?: string;
      supportingStaffProfile?: Record<string, unknown>;
      profilePhotoUrl?: string;
    } & PersonalDetailsInput;

    const {
      employeeId, collegeEmail, password, staffCategory, designation, highestQualification,
      joiningDate, profilePhotoUrl,
    } = body;

    if (!employeeId || !collegeEmail || !password || !staffCategory || !designation || !highestQualification || !joiningDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    // Matches the mandatory field set the bulk-import template and Add Staff
    // wizard's Personal Details step now both enforce. Name (as per PAN) and
    // Name (as per Aadhar) are deliberately excluded - both are optional.
    if (!body.mobileNo || !body.legalName || !body.gender || !body.dateOfBirth || !body.aadharNo || !body.panNo || !body.ratificationStatus) {
      return NextResponse.json({ error: "Missing required personal details - Mobile No, Full Name (as per SSC), Gender, Date of Birth, Aadhar No, PAN No, and Ratification Status are all required" }, { status: 400 });
    }
    if (!canRolePostCategory(session.role, staffCategory)) {
      return NextResponse.json(
        { error: `${(ROLE_LABELS as Record<string, string>)[session.role] ?? session.role} cannot add ${supportingStaffCategoryLabel(staffCategory)}` },
        { status: 403 }
      );
    }
    if (profilePhotoUrl !== undefined && !profilePhotoUrl.startsWith("https://firebasestorage.googleapis.com/")) {
      return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
    }

    // The name used everywhere this record is displayed/copied from (login
    // account, lists, timetable in-charge pickers, leave rosters) - Full Name
    // (as per SSC) is the primary identity name, so it takes precedence; Name
    // (as per PAN) is only a fallback for the rare case legalName is blank.
    // Mirrors Faculty's own `finalName` (src/app/api/college/faculty/route.ts).
    const finalName = body.legalName.trim() || body.nameAsPerPan?.trim() || "";

    const db = getAdminDb();
    const collegeId = session.collegeId;

    // Department is optional for Non-Technical (many of those roles - Librarian,
    // Accountant, centrally-hired staff - aren't owned by any single department),
    // but required and HOD-scope-validated for Technical, same as Faculty's POST.
    let department = body.department?.trim() ?? "";
    if (session.role === "HOD") {
      // Some college types (School) have no Technical/Non-Technical split at
      // all - Supporting Staff there is centrally managed by Principal, so
      // HOD has nothing to create. Backstops the nav-hide in Sidebar.tsx.
      const collegeSnap = await db.collection("colleges").doc(collegeId).get();
      const collegeType = (collegeSnap.data() as { type?: CollegeType } | undefined)?.type;
      if (!hasSupportingStaffSplit(collegeType)) {
        return NextResponse.json(
          { error: "Supporting Staff for your college type is managed centrally by Principal" },
          { status: 403 },
        );
      }

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
          { error: "You manage more than one department - specify which department this staff member belongs to" },
          { status: 400 },
        );
      }
      department = requested || scope.ownDepartmentNames[0] || "";
      if (!department) {
        return NextResponse.json({ error: "Department is required for Technical staff" }, { status: 400 });
      }
    }

    const existing = await db
      .collection("colleges")
      .doc(collegeId)
      .collection("supportingStaff")
      .where("employeeId", "==", employeeId)
      .limit(1)
      .get();
    if (!existing.empty) {
      return NextResponse.json({ error: "Employee ID already exists" }, { status: 409 });
    }

    const uid = await createFirebaseUser(collegeEmail, password, finalName);
    const now = new Date();

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
        role: "COLLEGE_STAFF",
        designation: designationLabel(designation),
        ...(department ? { department } : {}),
        ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

    const docRef = db.collection("colleges").doc(collegeId).collection("supportingStaff").doc();

    await docRef.set({
      collegeId,
      ...(department ? { department } : {}),
      employeeId,
      ...(body.apaarFacultyId ? { apaarFacultyId: body.apaarFacultyId } : {}),
      collegeEmail,
      ...(body.email ? { email: body.email } : {}),
      mobileNo: body.mobileNo ?? "",
      // Firestore has no ignoreUndefinedProperties, so a wholly-empty list
      // (or one with only blank rows) is left out entirely rather than
      // written as [] - same pattern as Faculty's own additionalPhoneNumbers
      // (src/app/api/college/faculty/route.ts).
      ...((() => {
        const numbers = (body.additionalPhoneNumbers ?? [])
          .map((p) => ({ ...(p.label?.trim() ? { label: p.label.trim() } : {}), number: p.number?.trim() ?? "" }))
          .filter((p) => p.number);
        return numbers.length > 0 ? { additionalPhoneNumbers: numbers } : {};
      })()),
      staffCategory,
      designation,
      ...(body.otherDesignationTitle ? { otherDesignationTitle: body.otherDesignationTitle } : {}),
      highestQualification,
      // Computed from Date of Joining, never trusted from client input - same
      // as Faculty's totalYearsOfExperience (src/app/api/college/faculty/route.ts).
      // No "previous experience entries" concept exists for Supporting Staff,
      // so this is purely tenure-since-joining.
      totalYearsOfExperience: experienceBreakdown(undefined, new Date(joiningDate)).total,
      joiningDate: new Date(joiningDate),
      status: "ACTIVE" as FacultyStatus,
      userUid: uid,
      ...(body.supportingStaffProfile ? { supportingStaffProfile: normalizeSupportingStaffProfile(body.supportingStaffProfile) } : {}),
      ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
      // Name (as per PAN) (nameAsPerPan) is stored verbatim, genuinely
      // optional, via this spread. Anything that needs "the" display name
      // reads legalName first - see finalName above and
      // supportingStaffDisplayName() (src/lib/supportingStaff/supportingStaffDisplayName.ts).
      ...buildPersonalDetailsUpdate(body),
      createdAt: now,
      updatedAt: now,
    });

    await db.collection("systemUsers").doc(uid).set({
      uid, role: "COLLEGE_STAFF", collegeId, email: collegeEmail, name: finalName,
      ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
    });

    return NextResponse.json({ id: docRef.id, uid }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err && typeof err === "object" && "code" in err && err.code === "auth/email-already-exists") {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    console.error("[college/supporting-staff POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
