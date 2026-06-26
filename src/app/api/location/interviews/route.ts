export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET() {
  try {
    const session = await verifySession();
    const allowed = ["SUPER_ADMIN", "ADMINISTRATION", "HR_ADMIN", "LOCATION_DEPT_HEAD"];
    if (!session || !allowed.includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.locationId) return NextResponse.json({ error: "No location context" }, { status: 400 });

    const db = getAdminDb();
    const snap = await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationInterviews")
      .orderBy("createdAt", "desc")
      .get();

    type InterviewDoc = { id: string; status: string; panelMembers?: { uid: string }[]; [key: string]: unknown };
    const interviews = snap.docs.map((d) => ({ id: d.id, ...d.data() } as InterviewDoc));

    // Administration sees only PENDING_ADMIN interviews (for approval)
    if (session.role === "ADMINISTRATION") {
      return NextResponse.json({ interviews: interviews.filter((i) => i.status === "PENDING_ADMIN") });
    }

    // LOCATION_DEPT_HEAD sees interviews they are a panel member of
    if (session.role === "LOCATION_DEPT_HEAD") {
      return NextResponse.json({
        interviews: interviews.filter((i) => {
          const panel = i.panelMembers ?? [];
          return panel.some((p) => p.uid === session.uid);
        }),
      });
    }

    // HR Admin and Super Admin see all
    return NextResponse.json({ interviews });
  } catch (err) {
    console.error("[location/interviews GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await verifySession();
    if (!session || session.role !== "HR_ADMIN") {
      return NextResponse.json({ error: "Only HR Admin can create interview plans" }, { status: 403 });
    }
    if (!session.locationId) return NextResponse.json({ error: "No location context" }, { status: 400 });

    const body = (await request.json()) as {
      vacancyId?: string;
      title: string;
      interviewDate: string;
      venue: string;
      panelMembers: { uid: string; name: string; role: string }[];
      shortlistedCandidateIds: string[];
      notes?: string;
    };

    const { title, interviewDate, venue, panelMembers, shortlistedCandidateIds, vacancyId, notes } = body;
    if (!title || !interviewDate || !venue || !panelMembers?.length || !shortlistedCandidateIds?.length) {
      return NextResponse.json({ error: "title, interviewDate, venue, panelMembers and shortlistedCandidateIds are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date();

    // Fetch shortlisted candidate names for denormalisation
    const candidateSnaps = await Promise.all(
      shortlistedCandidateIds.map((cid) =>
        db.collection("locations").doc(session.locationId!).collection("locationCandidates").doc(cid).get()
      )
    );
    const candidatesInfo = candidateSnaps
      .filter((s) => s.exists)
      .map((s) => ({ id: s.id, name: (s.data() as { name?: string }).name ?? "" }));

    // Get creator name from locationUsers
    const creatorSnap = await db.collection("locations").doc(session.locationId).collection("locationUsers").doc(session.uid).get();
    const creatorName = (creatorSnap.data() as { name?: string })?.name ?? session.email;

    const ref = await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationInterviews")
      .add({
        locationId: session.locationId,
        vacancyId: vacancyId ?? "",
        title: title.trim(),
        interviewDate: new Date(interviewDate),
        venue: venue.trim(),
        panelMembers,
        shortlistedCandidateIds,
        candidatesInfo,
        notes: notes?.trim() ?? "",
        status: "PENDING_ADMIN",
        callLetterSent: false,
        createdByUid: session.uid,
        createdByName: creatorName,
        createdAt: now,
        updatedAt: now,
      });

    // Notify Administration users
    const adminSnap = await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationUsers")
      .where("role", "==", "ADMINISTRATION")
      .get();

    const batch = db.batch();
    adminSnap.docs.forEach((d) => {
      const notifRef = db.collection("locations").doc(session.locationId).collection("locationNotifications").doc();
      batch.set(notifRef, {
        toUid: d.id,
        locationId: session.locationId,
        type: "INTERVIEW_PLAN_PENDING",
        title: "Interview Plan Awaiting Approval",
        message: `HR Admin has created an interview plan: "${title}". Please review and approve.`,
        link: `/administration/interviews/${ref.id}`,
        read: false,
        createdAt: now,
      });
    });
    await batch.commit();

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    console.error("[location/interviews POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
