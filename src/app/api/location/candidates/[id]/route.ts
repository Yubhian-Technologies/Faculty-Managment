export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const session = await verifySession();
    const allowed = ["SUPER_ADMIN", "ADMINISTRATION", "HR_ADMIN", "LOCATION_DEPT_HEAD"];
    if (!session || !allowed.includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.locationId) return NextResponse.json({ error: "No location context" }, { status: 400 });

    const db = getAdminDb();
    const doc = await db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationCandidates")
      .doc(id)
      .get();

    if (!doc.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ candidate: { id: doc.id, ...doc.data() } });
  } catch (err) {
    console.error("[location/candidates/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const session = await verifySession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session.locationId) return NextResponse.json({ error: "No location context" }, { status: 400 });

    const body = (await request.json()) as {
      action?: "SHORTLIST" | "REJECT_CANDIDATE";
      bioData?: Record<string, unknown>;
      status?: string;
    };

    const db = getAdminDb();
    const ref = db
      .collection("locations")
      .doc(session.locationId)
      .collection("locationCandidates")
      .doc(id);

    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    const now = new Date();

    // HR Admin can shortlist or reject candidates
    if (body.action === "SHORTLIST" || body.action === "REJECT_CANDIDATE") {
      if (session.role !== "HR_ADMIN") {
        return NextResponse.json({ error: "Only HR Admin can shortlist/reject candidates" }, { status: 403 });
      }
      const newStatus = body.action === "SHORTLIST" ? "SHORTLISTED" : "REJECTED";
      await ref.update({ status: newStatus, updatedAt: now });
      return NextResponse.json({ ok: true, status: newStatus });
    }

    // Candidate submits their own bio data (no auth required check — public form uses candidateId token)
    if (body.bioData) {
      await ref.update({ bioData: body.bioData, bioDataSubmitted: true, updatedAt: now });
      return NextResponse.json({ ok: true });
    }

    // HR Admin or Admin can update general status (SELECTED, OFFER_PENDING, etc.)
    if (body.status) {
      const canUpdate = session.role === "HR_ADMIN" || session.role === "ADMINISTRATION";
      if (!canUpdate) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      await ref.update({ status: body.status, updatedAt: now });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "No valid action provided" }, { status: 400 });
  } catch (err) {
    console.error("[location/candidates/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
