export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import { SUPPORTING_STAFF_ROLE_CATEGORY } from "@/lib/supportingStaff/roleCategory";
import {
  TECHNICAL_STAFF_DESIGNATION_LABELS, NON_TECHNICAL_STAFF_DESIGNATION_LABELS,
} from "@/types";
import type { SupportingStaffCategory, SupportingStaffDesignation } from "@/types";

function designationLabel(category: SupportingStaffCategory, designation: SupportingStaffDesignation): string {
  const labels = category === "TECHNICAL" ? TECHNICAL_STAFF_DESIGNATION_LABELS : NON_TECHNICAL_STAFF_DESIGNATION_LABELS;
  return (labels as Record<string, string>)[designation] ?? designation;
}

// Same "create the login after the record already exists" flow as
// /api/college/faculty/[id]/login - needed because CSV-imported Supporting
// Staff (see supporting-staff/import/route.ts) never get a Firebase Auth
// account or userUid, unlike the single "Add Staff" form which always
// creates one up front.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "COLLEGE_OFFICE");
    const { id } = await params;

    const body = (await request.json()) as { email?: string; password?: string };
    const { email, password } = body;

    if (!email || !password || password.length < 8) {
      return NextResponse.json(
        { error: "Email and password (min 8 characters) are required" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const ref = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("supportingStaff")
      .doc(id);

    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Staff record not found" }, { status: 404 });
    }

    const data = snap.data() as {
      userUid?: string; name?: string; department?: string; profilePhotoUrl?: string;
      staffCategory?: SupportingStaffCategory; designation?: SupportingStaffDesignation;
      otherDesignationTitle?: string;
    };

    const requiredCategory = SUPPORTING_STAFF_ROLE_CATEGORY[session.role];
    if (requiredCategory && data.staffCategory !== requiredCategory) {
      return NextResponse.json({ error: "Staff record not found" }, { status: 404 });
    }

    if (data.userUid) {
      return NextResponse.json(
        { error: "This staff member already has a login account" },
        { status: 409 }
      );
    }

    const name = data.name ?? "";
    const department = data.department ?? "";
    const profilePhotoUrl = data.profilePhotoUrl;
    const designation =
      data.designation === "OTHER" && data.otherDesignationTitle
        ? data.otherDesignationTitle
        : designationLabel(data.staffCategory ?? "TECHNICAL", data.designation ?? "OTHER");

    const uid = await createFirebaseUser(email, password, name);

    const now = new Date();

    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("users")
      .doc(uid)
      .set({
        uid,
        collegeId: session.collegeId,
        name,
        email,
        role: "COLLEGE_STAFF",
        designation,
        ...(department ? { department } : {}),
        ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

    await db.collection("systemUsers").doc(uid).set({
      uid,
      role: "COLLEGE_STAFF",
      collegeId: session.collegeId,
      email,
      name,
      ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
    });

    await ref.update({ userUid: uid, updatedAt: now });

    return NextResponse.json({ uid }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err && typeof err === "object" && "code" in err && err.code === "auth/email-already-exists") {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    console.error("[supporting-staff/[id]/login POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
