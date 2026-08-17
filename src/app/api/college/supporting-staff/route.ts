export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { SUPPORTING_STAFF_ROLE_CATEGORY, canRolePostCategory, supportingStaffCategoryLabel } from "@/lib/supportingStaff/roleCategory";
import { getHodTechnicalDesignations } from "@/lib/designations/config";
import { NON_TECHNICAL_STAFF_DESIGNATION_LABELS, ROLE_LABELS } from "@/types";
import type {
  SupportingStaffCategory, SupportingStaffDesignation, EmploymentType, FacultyStatus, CollegeType,
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
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      const ownedNames = ownOnly
        ? [scope.departmentName].filter((n): n is string => !!n)
        : [scope.departmentName, ...scope.childDepartmentNames, ...scope.managedDepartmentNames]
            .filter((n): n is string => !!n);
      if (ownedNames.length > 0) {
        query = query.where("department", "in", ownedNames.slice(0, 30));
      }
    }

    const snap = await query.get();
    const staff = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((a as { name?: string }).name ?? "").localeCompare((b as { name?: string }).name ?? ""));

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
      name: string;
      email?: string;
      collegeEmail: string;
      password: string;
      phone?: string;
      staffCategory: SupportingStaffCategory;
      designation: SupportingStaffDesignation;
      otherDesignationTitle?: string;
      experienceYears: number;
      joiningDate: string;
      employmentType: EmploymentType;
      department?: string;
      supportingStaffProfile?: Record<string, unknown>;
      profilePhotoUrl?: string;
    } & PersonalDetailsInput;

    const {
      employeeId, name, collegeEmail, password, staffCategory, designation,
      experienceYears, joiningDate, employmentType, profilePhotoUrl,
    } = body;

    if (!employeeId || !name || !collegeEmail || !password || !staffCategory || !designation || !employmentType || !joiningDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
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
      if (getHodTechnicalDesignations(collegeType).length === 0) {
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
      department = requested || scope.departmentName;
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

    const uid = await createFirebaseUser(collegeEmail, password, name);
    const now = new Date();

    await db
      .collection("colleges")
      .doc(collegeId)
      .collection("users")
      .doc(uid)
      .set({
        uid,
        collegeId,
        name,
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
      name,
      collegeEmail,
      ...(body.email ? { email: body.email } : {}),
      phone: body.phone ?? "",
      staffCategory,
      designation,
      ...(body.otherDesignationTitle ? { otherDesignationTitle: body.otherDesignationTitle } : {}),
      experienceYears: Number(experienceYears),
      joiningDate: new Date(joiningDate),
      employmentType,
      status: "ACTIVE" as FacultyStatus,
      userUid: uid,
      ...(body.supportingStaffProfile ? { supportingStaffProfile: body.supportingStaffProfile } : {}),
      ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
      ...buildPersonalDetailsUpdate(body),
      createdAt: now,
      updatedAt: now,
    });

    await db.collection("systemUsers").doc(uid).set({
      uid, role: "COLLEGE_STAFF", collegeId, email: collegeEmail, name,
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
