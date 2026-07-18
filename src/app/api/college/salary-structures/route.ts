export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

function computeGrossSalary(fields: {
  basic: number;
  hraPercent: number;
  daPercent: number;
  ta: number;
  medicalAllowance: number;
  otherAllowances: number;
}): number {
  const { basic, hraPercent, daPercent, ta, medicalAllowance, otherAllowances } = fields;
  return basic + (basic * hraPercent) / 100 + (basic * daPercent) / 100 + ta + medicalAllowance + otherAllowances;
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("ACCOUNTS", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD");
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("activeOnly") === "true";

    const db = getAdminDb();
    // isActive is filtered in memory: combining where("isActive") with
    // orderBy("designation") needs a composite index, and the per-college
    // structure count is small enough that the index isn't worth deploying.
    const snap = await db.collection("colleges").doc(session.collegeId).collection("salaryStructures").orderBy("designation").get();

    const salaryStructures = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as { isActive?: boolean }) }))
      .filter((s) => !activeOnly || s.isActive);
    return NextResponse.json({ salaryStructures });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/salary-structures GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("ACCOUNTS", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");

    const body = (await request.json()) as {
      name: string;
      designation: string;
      employmentType: string;
      basic: number;
      hraPercent: number;
      daPercent: number;
      ta: number;
      medicalAllowance: number;
      otherAllowances: number;
      employeePfPercent: number;
      employerPfPercent: number;
      professionalTax: number;
      effectiveFrom: string;
    };

    const { name, designation, employmentType, basic } = body;
    if (!name || !designation || !employmentType || basic === undefined) {
      return NextResponse.json({ error: "Name, designation, employment type and basic are required" }, { status: 400 });
    }

    const collegeId = session.collegeId;
    const db = getAdminDb();
    const now = new Date();

    const hraPercent = Number(body.hraPercent) || 0;
    const daPercent = Number(body.daPercent) || 0;
    const ta = Number(body.ta) || 0;
    const medicalAllowance = Number(body.medicalAllowance) || 0;
    const otherAllowances = Number(body.otherAllowances) || 0;
    const grossSalary = computeGrossSalary({ basic: Number(basic), hraPercent, daPercent, ta, medicalAllowance, otherAllowances });

    const ref = await db
      .collection("colleges")
      .doc(collegeId)
      .collection("salaryStructures")
      .add({
        collegeId,
        name: name.trim(),
        designation,
        employmentType,
        basic: Number(basic),
        hraPercent,
        daPercent,
        ta,
        medicalAllowance,
        otherAllowances,
        employeePfPercent: Number(body.employeePfPercent) || 0,
        employerPfPercent: Number(body.employerPfPercent) || 0,
        professionalTax: Number(body.professionalTax) || 0,
        grossSalary,
        effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : now,
        isActive: true,
        createdBy: session.uid,
        createdAt: now,
        updatedAt: now,
      });

    await db
      .collection("colleges")
      .doc(collegeId)
      .collection("auditLogs")
      .add({
        collegeId,
        action: "SALARY_STRUCTURE_CREATED" as string,
        performedBy: session.uid,
        performedByName: "Accounts",
        targetId: ref.id,
        details: { name, designation, employmentType, grossSalary },
        timestamp: now,
      });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/salary-structures POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeMember("ACCOUNTS", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");

    const body = (await request.json()) as {
      id: string;
      name?: string;
      designation?: string;
      employmentType?: string;
      basic?: number;
      hraPercent?: number;
      daPercent?: number;
      ta?: number;
      medicalAllowance?: number;
      otherAllowances?: number;
      employeePfPercent?: number;
      employerPfPercent?: number;
      professionalTax?: number;
      effectiveFrom?: string;
      isActive?: boolean;
    };

    const { id, ...updates } = body;
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("salaryStructures").doc(id);
    const existingSnap = await ref.get();
    if (!existingSnap.exists) {
      return NextResponse.json({ error: "Salary structure not found" }, { status: 404 });
    }
    const existing = existingSnap.data() as {
      basic: number;
      hraPercent: number;
      daPercent: number;
      ta: number;
      medicalAllowance: number;
      otherAllowances: number;
    };

    const merged = {
      basic: updates.basic !== undefined ? Number(updates.basic) : existing.basic,
      hraPercent: updates.hraPercent !== undefined ? Number(updates.hraPercent) : existing.hraPercent,
      daPercent: updates.daPercent !== undefined ? Number(updates.daPercent) : existing.daPercent,
      ta: updates.ta !== undefined ? Number(updates.ta) : existing.ta,
      medicalAllowance: updates.medicalAllowance !== undefined ? Number(updates.medicalAllowance) : existing.medicalAllowance,
      otherAllowances: updates.otherAllowances !== undefined ? Number(updates.otherAllowances) : existing.otherAllowances,
    };
    const grossSalary = computeGrossSalary(merged);

    const updatePayload: Record<string, unknown> = { ...updates, grossSalary, updatedAt: new Date() };
    if (updates.effectiveFrom) updatePayload.effectiveFrom = new Date(updates.effectiveFrom);

    await ref.update(updatePayload);

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/salary-structures PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember("ACCOUNTS", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const db = getAdminDb();
    // Soft delete: salaryStructureId may already be referenced by SalaryRecords
    // or submitted budget items, so we deactivate rather than remove the doc.
    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("salaryStructures")
      .doc(id)
      .update({ isActive: false, updatedAt: new Date() });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/salary-structures DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
