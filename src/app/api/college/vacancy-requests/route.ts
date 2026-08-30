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
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN", "COLLEGE_OFFICE", "ACCOUNTS", "COLLEGE_ACCOUNTS");
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const department = searchParams.get("department");

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("vacancyRequests")
      .orderBy("createdAt", "desc")
      .get();

    let requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (session.role === "HOD" || session.role === "VICE_PRINCIPAL") {
      requests = requests.filter((r) => (r as { hodUid?: string }).hodUid === session.uid);
    }
    if (status) {
      requests = requests.filter((r) => (r as { status?: string }).status === status);
    }
    if (department) {
      requests = requests.filter((r) => (r as { department?: string }).department === department);
    }

    return NextResponse.json({ vacancyRequests: requests });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/vacancy-requests GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      position: string;
      department: string;
      positionCategory: string;
      requiredCount: number;
      availableCount?: number;
      qualification?: string;
      justification?: string;
      hodJustification?: string;
      studentStrength?: number;
      totalFacultyRequired?: number;
      cadreRatioData?: unknown[];
      hiringMode?: "ONLINE" | "OFFLINE";
    };

    const { position, department, positionCategory, requiredCount, availableCount, qualification, justification } = body;
    if (!position || !department || !requiredCount) {
      return NextResponse.json({ error: "position, department, requiredCount required" }, { status: 400 });
    }

    // Only Vice Principal can submit General Admin vacancies; HOD cannot
    if (positionCategory === "GENERAL_ADMIN" && session.role !== "VICE_PRINCIPAL" && session.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Only Vice Principal can submit General Admin vacancy requests" }, { status: 403 });
    }

    const db = getAdminDb();
    const hodName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();

    const ref = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("vacancyRequests")
      .add({
        collegeId: session.collegeId,
        hodUid: session.uid,
        hodName,
        position: position.trim(),
        department: department.trim(),
        positionCategory: positionCategory ?? "TEACHING",
        requiredCount: Number(requiredCount),
        availableCount: Number(availableCount ?? 0),
        qualification: qualification?.trim() ?? "",
        justification: justification?.trim() ?? "",
        hodJustification: body.hodJustification?.trim() ?? "",
        hiringMode: body.hiringMode === "ONLINE" ? "ONLINE" : "OFFLINE",
        status: "PENDING",
        // Ratio-backed justification data
        studentStrength: body.studentStrength ?? 0,
        totalFacultyRequired: body.totalFacultyRequired ?? 0,
        cadreRatioData: body.cadreRatioData ?? [],
        createdAt: now,
        updatedAt: now,
      });

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "VACANCY_REQUEST_CREATED",
      performedBy: session.uid,
      performedByName: hodName,
      targetId: ref.id,
      details: { position, department },
      timestamp: now,
    });

    // Notify all Principals (and College Admins, who mirror Principal's
    // authority - see UserRole's own doc-comment) in the college
    const principalsSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("users")
      .where("role", "in", ["PRINCIPAL", "COLLEGE_ADMIN"])
      .get();

    const batch = db.batch();
    for (const p of principalsSnap.docs) {
      const notifRef = db.collection("colleges").doc(session.collegeId).collection("notifications").doc();
      batch.set(notifRef, {
        collegeId: session.collegeId,
        toUid: p.id,
        type: "GENERAL",
        title: "New Vacancy Request",
        message: `${hodName} submitted a vacancy request for ${position} in ${department}.`,
        link: `/principal/vacancies`,
        read: false,
        createdAt: now,
      });
    }
    await batch.commit();

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/vacancy-requests POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
