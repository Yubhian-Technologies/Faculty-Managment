export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET(request: Request) {
  try {
    const session = await verifySession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const allowed = ["SUPER_ADMIN", "ADMINISTRATION", "HR_ADMIN", "ADMIN_OFFICE", "LOCATION_DEPT_HEAD"];
    if (!allowed.includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId") ?? session.locationId;
    if (!locationId) return NextResponse.json({ error: "locationId required" }, { status: 400 });
    const collegeIdFilter = searchParams.get("collegeId");

    const db = getAdminDb();
    const snap = await db
      .collection("locations")
      .doc(locationId)
      .collection("locationVacancyRequests")
      .orderBy("createdAt", "desc")
      .get();

    let requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Optional college filter (see the Administration dashboard's college
    // picker) - plain post-fetch filter, same style as the role-based ones
    // below, since this collection is never large enough to need a composite
    // Firestore index for it.
    if (collegeIdFilter) {
      requests = requests.filter((r) => (r as { collegeId?: string }).collegeId === collegeIdFilter);
    }

    // Dept Head sees only their own submissions
    if (session.role === "LOCATION_DEPT_HEAD") {
      requests = requests.filter((r) => (r as { deptHeadUid?: string }).deptHeadUid === session.uid);
    }
    // HR Admin sees requests pending their review + ones they forwarded
    else if (session.role === "HR_ADMIN") {
      requests = requests.filter((r) => {
        const status = (r as { status?: string }).status ?? "";
        return status === "PENDING_HR" || (r as { forwardedByUid?: string }).forwardedByUid === session.uid;
      });
    }
    // Administration sees requests pending their approval
    else if (session.role === "ADMINISTRATION") {
      requests = requests.filter((r) => (r as { status?: string }).status === "PENDING_ADMIN");
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
    if (!session || session.role !== "LOCATION_DEPT_HEAD") {
      return NextResponse.json({ error: "Only Dept Head can submit vacancy requests" }, { status: 403 });
    }
    if (!session.locationId) {
      return NextResponse.json({ error: "No location context" }, { status: 400 });
    }

    const body = (await request.json()) as {
      department: string;
      qualification?: string;
      requiredCount: number;
      availableCount?: number;
      justification?: string;
      collegeId: string;
    };

    const { department, qualification, requiredCount, availableCount, justification, collegeId } = body;
    if (!department || !requiredCount) {
      return NextResponse.json({ error: "department and requiredCount are required" }, { status: 400 });
    }
    if (!collegeId) {
      return NextResponse.json({ error: "College is required" }, { status: 400 });
    }

    const db = getAdminDb();

    // Which college this vacancy is for - the root of the college-scoped
    // filter on the Administration dashboard (see LocationCollegeSelect);
    // every downstream interview/offer inherits it from here rather than
    // asking again. Verified against the caller's own location, not trusted
    // blindly from the client, since GET /api/admin/colleges (the picker's
    // own data source) can theoretically be bypassed by a hand-crafted request.
    const collegeSnap = await db.collection("colleges").doc(collegeId).get();
    if (!collegeSnap.exists || (collegeSnap.data() as { locationId?: string }).locationId !== session.locationId) {
      return NextResponse.json({ error: "Invalid college" }, { status: 400 });
    }
    const collegeName = (collegeSnap.data() as { name?: string }).name ?? "";

    // Get dept head name
    const userSnap = await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationUsers")
      .doc(session.uid)
      .get();
    const deptHeadName = (userSnap.data() as { name?: string } | undefined)?.name ?? "Dept Head";
    const deptHeadDept = (userSnap.data() as { department?: string } | undefined)?.department ?? department;

    const now = new Date();
    const ref = await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationVacancyRequests")
      .add({
        locationId: session.locationId,
        collegeId,
        collegeName,
        deptHeadUid: session.uid,
        deptHeadName,
        department: department.trim(),
        position: "Faculty",
        positionCategory: "FACULTY",
        qualification: qualification?.trim() ?? "",
        requiredCount: Number(requiredCount),
        availableCount: Number(availableCount ?? 0),
        justification: justification?.trim() ?? "",
        status: "PENDING_HR",
        createdAt: now,
        updatedAt: now,
      });

    // Notify all HR Admins in this location
    const hrSnap = await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationUsers")
      .where("role", "==", "HR_ADMIN")
      .get();

    const batch = db.batch();
    for (const hr of hrSnap.docs) {
      const notifRef = db
        .collection("locations")
        .doc(session.locationId)
        .collection("locationNotifications")
        .doc();
      batch.set(notifRef, {
        locationId: session.locationId,
        toUid: hr.id,
        type: "VACANCY_REQUEST",
        title: "New Faculty Vacancy Request",
        message: `${deptHeadName} (${deptHeadDept}) submitted a faculty vacancy request requiring ${requiredCount} position(s).`,
        link: "/hr-admin/vacancies",
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
