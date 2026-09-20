export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireLocationMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import { assignSeat, createSeat, listSeats, SeatError } from "@/lib/roles/seats";

// The first people in a brand-new college. A college starts empty, and every
// role that runs it (College Admin, Principal, Vice Principal, HODs) is a SEAT
// a person holds (see types/roleSeats.ts) - so before any seat can be filled
// there has to be a person. The location's Administration creates them here
// as College Office staff (their primary role - the seat comes on top) and, in the
// same step, appointing them College Admin (or Principal); the College
// Admin they appoint adds departments and faculty from there. A teaching
// person has no department yet: the College Admin files them under one (and
// completes their faculty profile) from the Faculty page.
export async function POST(request: Request) {
  try {
    const session = await requireLocationMember("ADMINISTRATION");
    const body = (await request.json()) as {
      collegeId?: string;
      name?: string;
      collegeEmail?: string;
      password?: string;
      phone?: string;
      designation?: string;
      dateOfJoining?: string;
      // Seat to put them in straight away - the usual case is the college's
      // first College Admin. Omit to just create the person.
      seatRole?: "COLLEGE_ADMIN" | "PRINCIPAL";
    };
    const { collegeId, name, collegeEmail, password, phone, designation, dateOfJoining } = body;
    const primaryRole = "COLLEGE_OFFICE";
    if (body.seatRole && body.seatRole !== "COLLEGE_ADMIN" && body.seatRole !== "PRINCIPAL") {
      return NextResponse.json({ error: "Invalid seat" }, { status: 400 });
    }

    if (!collegeId || !name?.trim() || !collegeEmail?.trim() || !password || !dateOfJoining) {
      return NextResponse.json({ error: "Name, college email, password and date of joining are required" }, { status: 400 });
    }
    if (Number.isNaN(new Date(dateOfJoining).getTime())) {
      return NextResponse.json({ error: "Invalid dateOfJoining" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeSnap = await db.collection("colleges").doc(collegeId).get();
    if (!collegeSnap.exists) return NextResponse.json({ error: "College not found" }, { status: 404 });
    if ((collegeSnap.data() as { locationId?: string }).locationId !== session.locationId) {
      return NextResponse.json({ error: "College does not belong to your location" }, { status: 403 });
    }

    const email = collegeEmail.trim().toLowerCase();
    const uid = await createFirebaseUser(email, password, name.trim());
    const now = new Date();

    await db.collection("colleges").doc(collegeId).collection("users").doc(uid).set({
      uid, collegeId, name: name.trim(), email, collegeEmail: email,
      ...(phone?.trim() ? { phone: phone.trim() } : {}),
      ...(designation?.trim() ? { designation: designation.trim() } : {}),
      role: primaryRole, department: "",
      dateOfJoining: new Date(dateOfJoining),
      isActive: true, createdAt: now, updatedAt: now,
    });
    await db.collection("systemUsers").doc(uid).set({ uid, role: primaryRole, collegeId, email, name: name.trim() });

    await db.collection("colleges").doc(collegeId).collection("auditLogs").add({
      collegeId, action: "USER_CREATED",
      performedBy: session.uid, performedByName: "Administration",
      targetId: uid, details: { email, role: primaryRole, name: name.trim() }, timestamp: now,
    });

    // Appoint them: reuse the college's open seat of that kind if there is one
    // (the Principal seat, or a College Admin seat nobody holds), else make it.
    let seatError: string | undefined;
    if (body.seatRole) {
      try {
        const actor = { uid: session.uid, name: "Administration" };
        const seats = await listSeats(db, collegeId);
        const open = seats.find((s) => s.isActive !== false && s.role === body.seatRole && !s.holderUid);
        const seatId = open?.id ?? await createSeat(db, collegeId, { role: body.seatRole }, actor);
        await assignSeat(db, collegeId, seatId, { uid }, actor);
      } catch (e) {
        // The login exists either way; they can be appointed from Role Assignments.
        seatError = e instanceof SeatError ? e.message : "Couldn't appoint them to the seat";
      }
    }

    return NextResponse.json({ uid, ...(seatError ? { seatError } : {}) }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_LOCATION_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "auth/email-already-exists") {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[administration/college-people POST]", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
