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
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN", "COLLEGE_OFFICE", "PANEL_MEMBER", "ACCOUNTS", "COLLEGE_ACCOUNTS");
    const { searchParams } = new URL(request.url);
    const candidateId = searchParams.get("candidateId");
    const vacancyRequestId = searchParams.get("vacancyRequestId");
    const batchId = searchParams.get("batchId");
    const isShortlisted = searchParams.get("isShortlisted");
    const status = searchParams.get("status");
    const stage = searchParams.get("stage");
    const department = searchParams.get("department");

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("candidateApplications")
      .orderBy("createdAt", "desc")
      .get();

    let applications = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (candidateId) applications = applications.filter((a) => (a as { candidateId?: string }).candidateId === candidateId);
    if (vacancyRequestId) applications = applications.filter((a) => (a as { vacancyRequestId?: string }).vacancyRequestId === vacancyRequestId);
    if (batchId) applications = applications.filter((a) => (a as { batchId?: string }).batchId === batchId);
    if (isShortlisted !== null && isShortlisted !== undefined) {
      const val = isShortlisted === "true";
      applications = applications.filter((a) => (a as { isShortlisted?: boolean }).isShortlisted === val);
    }
    if (status) applications = applications.filter((a) => (a as { status?: string }).status === status);
    if (stage) applications = applications.filter((a) => (a as { currentStage?: string }).currentStage === stage);
    if (department) applications = applications.filter((a) => (a as { department?: string }).department === department);

    return NextResponse.json({ applications });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/candidate-applications GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      candidateId: string;
      vacancyRequestId: string;
      courseId?: string;
      courseName?: string;
      year?: number;
      preferredSubjectIds?: string[];
      preferredSubjectNames?: string[];
    };

    const { candidateId, vacancyRequestId, courseId, courseName, year, preferredSubjectIds, preferredSubjectNames } = body;
    if (!candidateId || !vacancyRequestId) {
      return NextResponse.json({ error: "candidateId, vacancyRequestId required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const [candidateSnap, vacancySnap] = await Promise.all([
      collegeRef.collection("candidates").doc(candidateId).get(),
      collegeRef.collection("vacancyRequests").doc(vacancyRequestId).get(),
    ]);

    if (!candidateSnap.exists) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }
    if (!vacancySnap.exists) {
      return NextResponse.json({ error: "Hiring request not found" }, { status: 404 });
    }
    const vacancy = vacancySnap.data() as { status?: string; department?: string; position?: string; hiringMode?: string };
    if (vacancy.status !== "APPROVED") {
      return NextResponse.json({ error: "Hiring request is not approved" }, { status: 400 });
    }

    // An HOD may only attach candidates to their own department's hiring
    // requests - Principal/VP/SuperAdmin retain full cross-department access.
    if (session.role === "HOD") {
      const hodSnap = await collegeRef.collection("users").doc(session.uid).get();
      const hodDept = (hodSnap.data() as { department?: string } | undefined)?.department ?? "";
      if (hodDept && vacancy.department !== hodDept) {
        return NextResponse.json({ error: "You can only attach candidates to your own department's hiring requests" }, { status: 403 });
      }
    }

    // A candidate may only be actively attached to one hiring request at a time
    // (REJECTED applications don't count, so a rejected candidate can be re-attached
    // elsewhere). This also covers the same-vacancy-twice case.
    const existingSnap = await collegeRef
      .collection("candidateApplications")
      .where("candidateId", "==", candidateId)
      .get();
    const activeApplication = existingSnap.docs.find((d) => (d.data() as { status?: string }).status !== "REJECTED");
    if (activeApplication) {
      const data = activeApplication.data() as { vacancyRequestId?: string; position?: string };
      const message =
        data.vacancyRequestId === vacancyRequestId
          ? "Candidate is already attached to this hiring request"
          : `Candidate is already attached to another hiring request (${data.position ?? "unknown position"})`;
      return NextResponse.json({ error: message }, { status: 409 });
    }

    const addedByName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();

    const ref = await collegeRef.collection("candidateApplications").add({
      collegeId: session.collegeId,
      candidateId,
      vacancyRequestId,
      batchId: "",
      department: vacancy.department ?? "",
      position: vacancy.position ?? "",
      ...(courseId ? { courseId, courseName: courseName ?? "" } : {}),
      ...(year ? { year: Number(year) } : {}),
      ...(preferredSubjectIds?.length ? { preferredSubjectIds, preferredSubjectNames: preferredSubjectNames ?? [] } : {}),
      currentStage: "DEMO",
      status: "PENDING",
      isShortlisted: false,
      hasArrived: false,
      addedByUid: session.uid,
      addedByName,
      createdAt: now,
      updatedAt: now,
    });

    const candidateName = (candidateSnap.data() as { name?: string }).name;
    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "CANDIDATE_APPLICATION_CREATED",
      performedBy: session.uid,
      performedByName: addedByName,
      targetId: ref.id,
      details: { candidateId, candidateName, vacancyRequestId, position: vacancy.position, department: vacancy.department },
      timestamp: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/candidate-applications POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
