export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET(request: Request) {
  try {
    const session = await verifySession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const allowed = ["SUPER_ADMIN", "ADMINISTRATION", "HR_ADMIN", "ADMIN_OFFICE"];
    if (!allowed.includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId") ?? session.locationId;
    if (!locationId) return NextResponse.json({ error: "locationId required" }, { status: 400 });

    const db = getAdminDb();
    const snap = await db
      .collection("locations")
      .doc(locationId)
      .collection("locationVacancyRequests")
      .orderBy("createdAt", "desc")
      .get();

    let requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // HR Admin only sees their own requests
    if (session.role === "HR_ADMIN") {
      requests = requests.filter((r) => (r as { submittedByUid?: string }).submittedByUid === session.uid);
    }

    return NextResponse.json({ vacancyRequests: requests });
  } catch (err) {
    console.error("[location/vacancy-requests GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await verifySession();
    if (!session || session.role !== "HR_ADMIN") {
      return NextResponse.json({ error: "Only HR Admin can submit location vacancy requests" }, { status: 403 });
    }
    if (!session.locationId) {
      return NextResponse.json({ error: "No location context" }, { status: 400 });
    }

    const body = (await request.json()) as {
      department: string;
      position: string;
      qualification?: string;
      requiredCount: number;
      availableCount?: number;
      justification?: string;
    };

    const { department, position, qualification, requiredCount, availableCount, justification } = body;
    if (!department || !position || !requiredCount) {
      return NextResponse.json({ error: "department, position, requiredCount required" }, { status: 400 });
    }

    const db = getAdminDb();

    // Get HR Admin name
    const userSnap = await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationUsers")
      .doc(session.uid)
      .get();
    const submittedByName = (userSnap.data() as { name?: string } | undefined)?.name ?? "HR Admin";

    const now = new Date();
    const ref = await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationVacancyRequests")
      .add({
        locationId: session.locationId,
        submittedByUid: session.uid,
        submittedByName,
        department: department.trim(),
        position: position.trim(),
        positionCategory: "GENERAL_ADMIN",
        qualification: qualification?.trim() ?? "",
        requiredCount: Number(requiredCount),
        availableCount: Number(availableCount ?? 0),
        justification: justification?.trim() ?? "",
        status: "PENDING",
        createdAt: now,
        updatedAt: now,
      });

    // Notify Administration
    const adminsSnap = await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationUsers")
      .where("role", "==", "ADMINISTRATION")
      .get();

    const batch = db.batch();
    for (const admin of adminsSnap.docs) {
      const notifRef = db
        .collection("locations")
        .doc(session.locationId)
        .collection("locationNotifications")
        .doc();
      batch.set(notifRef, {
        locationId: session.locationId,
        toUid: admin.id,
        type: "VACANCY_REQUEST",
        title: "New Location Vacancy Request",
        message: `${submittedByName} submitted a vacancy request for ${position} in ${department}.`,
        link: "/administration/vacancies",
        read: false,
        createdAt: now,
      });
    }
    await batch.commit();

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    console.error("[location/vacancy-requests POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
