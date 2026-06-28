export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Designation, EmploymentType } from "@/types";

const DESIGNATION_MAP: Record<string, Designation> = {
  "professor": "PROFESSOR",
  "prof.": "PROFESSOR",
  "associate professor": "ASSOCIATE_PROFESSOR",
  "assoc. prof.": "ASSOCIATE_PROFESSOR",
  "assoc.prof.": "ASSOCIATE_PROFESSOR",
  "assistant professor": "ASSISTANT_PROFESSOR",
  "asst. prof.": "ASSISTANT_PROFESSOR",
  "asst.prof.": "ASSISTANT_PROFESSOR",
  "asst prof": "ASSISTANT_PROFESSOR",
  "lecturer": "LECTURER",
  "visiting faculty": "VISITING_FACULTY",
  "adjunct faculty": "ADJUNCT_FACULTY",
  "lab assistant": "LAB_ASSISTANT",
};

const EMPLOYMENT_MAP: Record<string, EmploymentType> = {
  "regular": "PERMANENT",
  "permanent": "PERMANENT",
  "contract": "CONTRACT",
  "visiting": "VISITING",
  "part-time": "PART_TIME",
  "part time": "PART_TIME",
  "regular(phy)": "PERMANENT",
  "dummy": "CONTRACT",
};

type ImportRow = {
  employeeId: string;
  name: string;
  email: string;
  phone?: string;
  designation: string;
  qualification: string;
  specialization?: string;
  employmentType: string;
  joiningDate: string;
  dateOfBirth?: string;
  gender?: string;
  fatherName?: string;
  motherName?: string;
  aadharNo?: string;
  panNo?: string;
  religion?: string;
  caste?: string;
  legalName?: string;
  collegeEmail?: string;
  ratificationStatus?: string;
  ratificationDate?: string;
  hasPHD?: string;
  experienceYears?: string;
  internalExperience?: string;
  externalExperience?: string;
  inCampusExperience?: string;
  industryExperience?: string;
  researchExperience?: string;
};

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as { records: ImportRow[] };

    if (!body.records || !Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }

    if (body.records.length > 500) {
      return NextResponse.json({ error: "Maximum 500 records per import" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;

    // Resolve HOD's department
    let hodDept = "";
    if (session.role === "HOD") {
      const hodSnap = await db.collection("colleges").doc(collegeId).collection("users").doc(session.uid).get();
      hodDept = (hodSnap.data() as { department?: string } | undefined)?.department ?? "";
    }

    // Load existing employeeIds to detect duplicates
    const existingSnap = await db.collection("colleges").doc(collegeId).collection("facultyMembers")
      .select("employeeId").get();
    const existingIds = new Set(existingSnap.docs.map((d) => (d.data() as { employeeId: string }).employeeId));

    const now = new Date();
    const created: string[] = [];
    const failed: { row: number; employeeId: string; error: string }[] = [];

    const batch = db.batch();
    let batchCount = 0;

    for (let i = 0; i < body.records.length; i++) {
      const row = body.records[i];
      const rowNum = i + 2; // 1-indexed + header row

      // Required field validation
      if (!row.employeeId?.trim()) { failed.push({ row: rowNum, employeeId: "—", error: "Employee ID is required" }); continue; }
      if (!row.name?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Name is required" }); continue; }
      if (!row.email?.trim() || !row.email.includes("@")) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Valid email is required" }); continue; }
      if (!row.joiningDate?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Joining date is required" }); continue; }

      const empId = row.employeeId.trim();
      if (existingIds.has(empId)) {
        failed.push({ row: rowNum, employeeId: empId, error: "Employee ID already exists" });
        continue;
      }

      // Map designation
      const designationKey = (row.designation ?? "").trim().toLowerCase();
      const designation: Designation = DESIGNATION_MAP[designationKey] ?? "ASSISTANT_PROFESSOR";

      // Map employment type
      const empTypeKey = (row.employmentType ?? "").trim().toLowerCase();
      const employmentType: EmploymentType = EMPLOYMENT_MAP[empTypeKey] ?? "PERMANENT";

      // Parse dates
      const joiningDate = row.joiningDate ? new Date(row.joiningDate) : now;
      const dateOfBirth = row.dateOfBirth ? new Date(row.dateOfBirth) : undefined;
      const ratificationDate = row.ratificationDate ? new Date(row.ratificationDate) : undefined;

      // Determine department
      const department = hodDept || "";

      const docRef = db.collection("colleges").doc(collegeId).collection("facultyMembers").doc();

      const payload: Record<string, unknown> = {
        collegeId,
        department,
        employeeId: empId,
        name: row.name.trim(),
        email: row.email.trim().toLowerCase(),
        phone: row.phone?.trim() ?? "",
        designation,
        qualification: row.qualification?.trim() ?? "",
        specialization: row.specialization?.trim() ?? "",
        employmentType,
        experienceYears: parseFloat(row.experienceYears ?? "0") || 0,
        joiningDate,
        status: "ACTIVE",
        gender: row.gender?.trim() || undefined,
        dateOfBirth: dateOfBirth || undefined,
        legalName: row.legalName?.trim() || undefined,
        fatherName: row.fatherName?.trim() || undefined,
        motherName: row.motherName?.trim() || undefined,
        aadharNo: row.aadharNo?.trim() || undefined,
        panNo: row.panNo?.trim().toUpperCase() || undefined,
        religion: row.religion?.trim() || undefined,
        caste: row.caste?.trim() || undefined,
        collegeEmail: row.collegeEmail?.trim().toLowerCase() || undefined,
        ratificationStatus: row.ratificationStatus?.toLowerCase().includes("not") ? "Not Ratified" : row.ratificationStatus?.trim() ? "Ratified" : undefined,
        ratificationDate: ratificationDate || undefined,
        hasPHD: row.hasPHD ? row.hasPHD.trim().toLowerCase() === "yes" : undefined,
        internalExperience: row.internalExperience ? parseFloat(row.internalExperience) || undefined : undefined,
        externalExperience: row.externalExperience ? parseFloat(row.externalExperience) || undefined : undefined,
        inCampusExperience: row.inCampusExperience ? parseFloat(row.inCampusExperience) || undefined : undefined,
        industryExperience: row.industryExperience ? parseFloat(row.industryExperience) || undefined : undefined,
        researchExperience: row.researchExperience ? parseFloat(row.researchExperience) || undefined : undefined,
        createdAt: now,
        updatedAt: now,
      };

      // Remove undefined values
      for (const key of Object.keys(payload)) {
        if (payload[key] === undefined) delete payload[key];
      }

      batch.set(docRef, payload);
      existingIds.add(empId); // prevent duplicates within the same batch
      created.push(empId);
      batchCount++;

      // Firestore batch limit is 500 writes
      if (batchCount === 499) break;
    }

    await batch.commit();

    return NextResponse.json({ created: created.length, failed }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[faculty/import POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
