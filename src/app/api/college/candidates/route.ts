export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Firestore } from "firebase-admin/firestore";

async function getUserName(db: Firestore, collegeId: string, uid: string): Promise<string> {
  if (!collegeId || !uid) return "Unknown";
  try {
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
    return (snap.data() as { name?: string } | undefined)?.name ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "HOD", "SUPER_ADMIN", "COLLEGE_OFFICE", "PANEL_MEMBER", "ACCOUNTS");
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batchId");
    const vacancyId = searchParams.get("vacancyId");
    const isShortlisted = searchParams.get("isShortlisted");
    const status = searchParams.get("status");
    const stage = searchParams.get("stage");
    const department = searchParams.get("department");

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("candidates")
      .orderBy("createdAt", "desc")
      .get();

    let candidates = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (batchId) candidates = candidates.filter((c) => (c as { batchId?: string }).batchId === batchId);
    if (vacancyId) candidates = candidates.filter((c) => (c as { vacancyId?: string }).vacancyId === vacancyId);
    if (isShortlisted !== null && isShortlisted !== undefined) {
      const val = isShortlisted === "true";
      candidates = candidates.filter((c) => (c as { isShortlisted?: boolean }).isShortlisted === val);
    }
    if (status) candidates = candidates.filter((c) => (c as { status?: string }).status === status);
    if (stage) candidates = candidates.filter((c) => (c as { currentStage?: string }).currentStage === stage);
    if (department) candidates = candidates.filter((c) => (c as { department?: string }).department === department);

    return NextResponse.json({ candidates });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/candidates GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      name: string;
      email: string;
      phone: string;
      department: string;
      position: string;
      resumeUrl?: string;
      source?: string;
      interviewMode?: string;
      vacancyId?: string;
      batchId?: string;
      referralType?: string;
      referralName?: string;
      referralPhone?: string;
      referralDescription?: string;
      residenceAddress?: string;
      permanentAddress?: string;
    };

    const { name, email, phone, department, position, resumeUrl, source, interviewMode, vacancyId, batchId, referralType, referralName, referralPhone, referralDescription, residenceAddress, permanentAddress } = body;
    if (!name || !email || !phone || !department || !position) {
      return NextResponse.json({ error: "name, email, phone, department, position required" }, { status: 400 });
    }

    const db = getAdminDb();
    const addedByName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();

    const ref = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("candidates")
      .add({
        collegeId: session.collegeId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        department: department.trim(),
        position: position.trim(),
        resumeUrl: resumeUrl ?? "",
        source: source ?? "WALK_IN",
        interviewMode: interviewMode ?? "OFFLINE",
        vacancyId: vacancyId ?? "",
        batchId: batchId ?? "",
        ...(residenceAddress ? { residenceAddress: residenceAddress.trim() } : {}),
        ...(permanentAddress ? { permanentAddress: permanentAddress.trim() } : {}),
        ...(source === "REFERRAL" ? {
          referralType: referralType ?? "INTERNAL",
          ...(referralName ? { referralName: referralName.trim() } : {}),
          ...(referralPhone ? { referralPhone: referralPhone.trim() } : {}),
          ...(referralDescription ? { referralDescription: referralDescription.trim() } : {}),
        } : {}),
        currentStage: "DEMO",
        status: "PENDING",
        isShortlisted: false,
        hasArrived: false,
        addedByUid: session.uid,
        addedByName,
        createdAt: now,
        updatedAt: now,
      });

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "CANDIDATE_ADDED",
      performedBy: session.uid,
      performedByName: addedByName,
      targetId: ref.id,
      details: { name, email, position, department },
      timestamp: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/candidates POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
