export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember, requireSuperAdmin } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// GET — Super Admin retrieves all General Admin vacancy requests
export async function GET() {
  try {
    const session = await requireSuperAdmin();
    void session;

    const db = getAdminDb();
    const snap = await db
      .collection("generalAdminVacancies")
      .orderBy("createdAt", "desc")
      .get();

    const requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ vacancyRequests: requests });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[general-admin-vacancies GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// POST — Vice Principal (PRINCIPAL role) submits a General Admin vacancy request
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      position: string;
      requiredCount: number;
      availableCount?: number;
      justification?: string;
    };

    const { position, requiredCount, availableCount, justification } = body;
    if (!position || !requiredCount) {
      return NextResponse.json({ error: "position and requiredCount required" }, { status: 400 });
    }

    const db = getAdminDb();

    // Get college name for display in super-admin view
    const collegeSnap = await db.collection("colleges").doc(session.collegeId).get();
    const collegeName = (collegeSnap.data() as { name?: string } | undefined)?.name ?? session.collegeId;

    // Get submitter name
    const userSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("users")
      .doc(session.uid)
      .get();
    const submittedByName = (userSnap.data() as { name?: string } | undefined)?.name ?? "Vice Principal";

    const now = new Date();
    const ref = await db.collection("generalAdminVacancies").add({
      collegeId: session.collegeId,
      collegeName,
      submittedByUid: session.uid,
      submittedByName,
      position: position.trim(),
      positionCategory: "GENERAL_ADMIN",
      requiredCount: Number(requiredCount),
      availableCount: Number(availableCount ?? 0),
      justification: justification?.trim() ?? "",
      status: "PENDING",
      createdAt: now,
      updatedAt: now,
    });

    // Notify Super Admins via systemUsers collection
    const superAdminsSnap = await db
      .collection("systemUsers")
      .where("role", "==", "SUPER_ADMIN")
      .get();

    const batch = db.batch();
    for (const sa of superAdminsSnap.docs) {
      const notifRef = db.collection("systemNotifications").doc();
      batch.set(notifRef, {
        toUid: sa.id,
        type: "GENERAL_ADMIN_VACANCY",
        title: "New General Admin Vacancy Request",
        message: `${submittedByName} from ${collegeName} submitted a General Admin vacancy for ${position}.`,
        link: "/super-admin/vacancies",
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
    console.error("[general-admin-vacancies POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
