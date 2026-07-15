export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Designation, EmploymentType, FacultyStatus } from "@/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE");
    const { id } = await params;

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("facultyMembers")
      .doc(id)
      .get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ faculty: { id: snap.id, ...snap.data() } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL");
    const { id } = await params;

    const body = (await request.json()) as Partial<{
      name: string;
      email: string;
      phone: string;
      collegeEmail: string;
      designation: Designation;
      qualification: string;
      specialization: string;
      experienceYears: number;
      internalExperience: number;
      externalExperience: number;
      inCampusExperience: number;
      industryExperience: number;
      researchExperience: number;
      joiningDate: string;
      dateOfBirth: string;
      employmentType: EmploymentType;
      status: FacultyStatus;
      gender: string;
      legalName: string;
      fatherName: string;
      motherName: string;
      religion: string;
      caste: string;
      aadharNo: string;
      panNo: string;
      ratificationStatus: string;
      ratificationDate: string;
      maritalStatus: string;
      spouseName: string;
      numberOfChildren: number;
      referral: string;
      nativePlace: string;
      temporaryAddress: string;
      permanentSameAsTemporary: boolean;
      permanentAddress: string;
      bloodGroup: string;
      hasPHD: boolean;
      userUid: string;
      academicProfile: Record<string, unknown>;
    }>;

    const db = getAdminDb();
    const ref = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("facultyMembers")
      .doc(id);

    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    const stringFields = [
      "name", "email", "phone", "collegeEmail", "designation", "qualification",
      "specialization", "employmentType", "status", "gender", "legalName",
      "fatherName", "motherName", "religion", "caste", "aadharNo", "ratificationStatus", "userUid",
      "maritalStatus", "spouseName", "referral", "nativePlace", "temporaryAddress", "permanentAddress", "bloodGroup",
    ] as const;

    for (const key of stringFields) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    // PAN always uppercase
    if (body.panNo !== undefined) updates.panNo = body.panNo.toUpperCase();

    // Numeric fields
    const numFields = [
      "experienceYears", "internalExperience", "externalExperience",
      "inCampusExperience", "industryExperience", "researchExperience", "numberOfChildren",
    ] as const;
    for (const key of numFields) {
      if (body[key] !== undefined) updates[key] = Number(body[key]);
    }

    // Boolean
    if (body.hasPHD !== undefined) updates.hasPHD = body.hasPHD;
    if (body.permanentSameAsTemporary !== undefined) updates.permanentSameAsTemporary = body.permanentSameAsTemporary;

    // Academic profile (Modules 1-5)
    if (body.academicProfile !== undefined) updates.academicProfile = body.academicProfile;

    // Date fields
    if (body.joiningDate) updates.joiningDate = new Date(body.joiningDate);
    if (body.dateOfBirth) updates.dateOfBirth = new Date(body.dateOfBirth);
    if (body.ratificationDate) updates.ratificationDate = new Date(body.ratificationDate);

    await ref.update(updates);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL");
    const { id } = await params;

    const db = getAdminDb();
    const ref = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("facultyMembers")
      .doc(id);

    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await ref.delete();
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
