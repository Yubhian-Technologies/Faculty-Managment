export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { financialYearLabel } from "@/lib/college/financialYear";

// colleges/{collegeId}/financialYears - the college's financial year periods
// (start date -> end date, so the duration is set by the Principal / College
// Admin rather than assumed to be April-March). Finance picks from this list
// when opening a budget cycle. PRINCIPAL is also what a College Admin/Director
// resolves to at session time.
const READ_ROLES = ["SUPER_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL", "FINANCE", "ACCOUNTS", "COLLEGE_ACCOUNTS", "HOD", "COLLEGE_OFFICE"];
const WRITE_ROLES = ["SUPER_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isAuthError(err: unknown) {
  return err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT");
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeContext(request, ...READ_ROLES);
    const snap = await getAdminDb().collection("colleges").doc(session.collegeId).collection("financialYears").get();
    const financialYears = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String((b as { startDate?: string }).startDate).localeCompare(String((a as { startDate?: string }).startDate)));
    return NextResponse.json({ financialYears });
  } catch (err) {
    if (isAuthError(err)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[college/financial-years GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeContext(request, ...WRITE_ROLES);
    const body = (await request.json()) as { startDate?: string; endDate?: string };
    const startDate = body.startDate?.trim() ?? "";
    const endDate = body.endDate?.trim() ?? "";

    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate) || Number.isNaN(Date.parse(startDate)) || Number.isNaN(Date.parse(endDate))) {
      return NextResponse.json({ error: "startDate and endDate are required (YYYY-MM-DD)" }, { status: 400 });
    }
    if (endDate <= startDate) {
      return NextResponse.json({ error: "End date must be after the start date" }, { status: 400 });
    }

    const collection = getAdminDb().collection("colleges").doc(session.collegeId).collection("financialYears");
    const existing = await collection.get();
    // Periods must not overlap - "which financial year is this date in" has to have one answer.
    const clash = existing.docs.find((d) => {
      const e = d.data() as { startDate: string; endDate: string };
      return startDate <= e.endDate && endDate >= e.startDate;
    });
    if (clash) {
      const c = clash.data() as { label: string };
      return NextResponse.json({ error: `These dates overlap the existing financial year ${c.label}` }, { status: 409 });
    }

    const now = new Date();
    const ref = await collection.add({
      collegeId: session.collegeId,
      label: financialYearLabel(startDate, endDate),
      startDate,
      endDate,
      createdBy: session.uid,
      createdAt: now,
      updatedAt: now,
    });
    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (isAuthError(err)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[college/financial-years POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeContext(request, ...WRITE_ROLES);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("financialYears").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // A budget cycle already opened against this year keeps pointing at its label.
    const label = (snap.data() as { label: string }).label;
    const used = await db.collection("colleges").doc(session.collegeId).collection("budgetCycles").where("financialYear", "==", label).limit(1).get();
    if (!used.empty) {
      return NextResponse.json({ error: `Budget cycles already use ${label}, so it can't be removed` }, { status: 409 });
    }
    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isAuthError(err)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[college/financial-years DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
