export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { syncCompensatoryWorkingDay } from "@/lib/college/compensatorySync";
import { isDateKey, isSundayKey } from "@/lib/college/holidayCalendar";
import { istDateKey } from "@/lib/attendance/istTime";

// Edits to an existing holiday. The Principal or Vice Principal switches a bridge holiday's
// compensatory Sunday on or off (it decides whether students AND faculty work
// that Sunday); Office/VP may still set which Sunday it would be, or the
// hostellers-outing flag, as long as the Sunday is not already live.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE");
    const { id } = await params;
    const body = (await readJsonBody(request)) as {
      compensatoryEnabled?: boolean; compensatoryDateKey?: string; hostelersOutingAllowed?: boolean;
    };

    const db = getAdminDb();
    const docRef = db.collection("colleges").doc(session.collegeId).collection("holidays").doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return NextResponse.json({ error: "Holiday not found" }, { status: 404 });
    const holiday = snap.data() as {
      name: string; date: { toDate(): Date }; category?: string;
      compensatoryDateKey?: string; compensatoryEnabled?: boolean;
    };

    const update: Record<string, unknown> = {};
    if (body.hostelersOutingAllowed != null) {
      if (typeof body.hostelersOutingAllowed !== "boolean") {
        return NextResponse.json({ error: "Invalid hostellers outing value" }, { status: 400 });
      }
      update.hostelersOutingAllowed = body.hostelersOutingAllowed;
    }

    const touchesCompensatory = body.compensatoryEnabled != null || body.compensatoryDateKey != null;
    if (touchesCompensatory) {
      if (holiday.category !== "BRIDGE") {
        return NextResponse.json({ error: "Only a compensatory holiday has a compensatory Sunday" }, { status: 400 });
      }
      const isPrincipal = session.role === "PRINCIPAL" || session.role === "VICE_PRINCIPAL";
      if (body.compensatoryEnabled != null && !isPrincipal) {
        return NextResponse.json({ error: "Only the Principal or Vice Principal can switch the compensatory Sunday on or off" }, { status: 403 });
      }
      if (body.compensatoryDateKey != null) {
        if (holiday.compensatoryEnabled && !isPrincipal) {
          return NextResponse.json({ error: "Only the Principal or Vice Principal can move a compensatory Sunday that is already on" }, { status: 403 });
        }
        const holidayKey = istDateKey(holiday.date.toDate());
        if (!isDateKey(body.compensatoryDateKey) || !isSundayKey(body.compensatoryDateKey) || body.compensatoryDateKey <= holidayKey) {
          return NextResponse.json({ error: "The compensatory day must be a Sunday after the holiday" }, { status: 400 });
        }
        update.compensatoryDateKey = body.compensatoryDateKey;
      }
      const dateKey = (update.compensatoryDateKey as string | undefined) ?? holiday.compensatoryDateKey;
      const enabled = body.compensatoryEnabled ?? holiday.compensatoryEnabled ?? false;
      if (enabled && !dateKey) {
        return NextResponse.json({ error: "Pick the Sunday first" }, { status: 400 });
      }
      if (body.compensatoryEnabled != null) update.compensatoryEnabled = body.compensatoryEnabled;
      await docRef.update(update);
      await syncCompensatoryWorkingDay(db, session.collegeId, { id, name: holiday.name, enabled, dateKey });
      return NextResponse.json({ ok: true });
    }

    if (Object.keys(update).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    await docRef.update(update);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/holidays/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE");
    const { id } = await params;

    const db = getAdminDb();
    const docRef = db.collection("colleges").doc(session.collegeId).collection("holidays").doc(id);
    const snap = await docRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Holiday not found" }, { status: 404 });
    }
    await docRef.delete();
    // A bridge holiday's compensatory Sunday goes with it.
    await syncCompensatoryWorkingDay(db, session.collegeId, { id, name: "", enabled: false });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/holidays/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
