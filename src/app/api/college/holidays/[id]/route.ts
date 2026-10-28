export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { syncCompensatoryWorkingDay } from "@/lib/college/compensatorySync";
import { isDateKey, isSundayKey, weekdayOfKey } from "@/lib/college/holidayCalendar";
import { istDateKey } from "@/lib/attendance/istTime";
import { academicYearForDate } from "@/lib/college/compensatorySync";
import { HOLIDAY_TYPE_LABELS } from "@/types";
import type { HolidayAudience, HolidayType } from "@/types";

// Edits to an existing holiday: its name, date, type, audience and hostellers-outing flag (the category
// stays as filed - delete and add again to change it). The Principal or Vice Principal switches a bridge holiday's
// compensatory Sunday on or off (it decides whether students AND faculty work
// that Sunday); Office/VP may still set which Sunday it would be, or the
// hostellers-outing flag, as long as the Sunday is not already live.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "ACADEMICS");
    const { id } = await params;
    const body = (await readJsonBody(request)) as {
      compensatoryEnabled?: boolean; compensatoryDateKey?: string; hostelersOutingAllowed?: boolean;
      name?: string; date?: string; type?: HolidayType; appliesTo?: HolidayAudience;
    };

    const db = getAdminDb();
    const docRef = db.collection("colleges").doc(session.collegeId).collection("holidays").doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return NextResponse.json({ error: "Holiday not found" }, { status: 404 });
    const holiday = snap.data() as {
      name: string; date: { toDate(): Date }; category?: string;
      compensatoryDateKey?: string; compensatoryEnabled?: boolean; type?: string; appliesTo?: string;
    };

    const update: Record<string, unknown> = {};
    let name = holiday.name;
    let edited = false;
    if (body.name != null) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return NextResponse.json({ error: "Name can't be blank" }, { status: 400 });
      }
      name = body.name.trim();
      update.name = name;
      edited = true;
    }
    if (body.type != null) {
      if (holiday.category && holiday.category !== "REGULAR") {
        return NextResponse.json({ error: "Only a regular holiday has a type" }, { status: 400 });
      }
      if (!Object.keys(HOLIDAY_TYPE_LABELS).includes(body.type)) {
        return NextResponse.json({ error: "Invalid holiday type" }, { status: 400 });
      }
      update.type = body.type;
    }
    if (body.appliesTo != null) {
      if (holiday.category === "BRIDGE") {
        return NextResponse.json({ error: "A compensatory holiday is always for everyone" }, { status: 400 });
      }
      if (body.appliesTo !== "BOTH" && body.appliesTo !== "STUDENTS") {
        return NextResponse.json({ error: "Invalid audience" }, { status: 400 });
      }
      update.appliesTo = body.appliesTo;
    }
    if (body.date != null) {
      const date = new Date(body.date);
      if (typeof body.date !== "string" || Number.isNaN(date.getTime())) {
        return NextResponse.json({ error: "Invalid date" }, { status: 400 });
      }
      const dateKey = isDateKey(body.date) ? body.date : istDateKey(date);
      if (holiday.category === "BRIDGE") {
        const followsDay = weekdayOfKey(dateKey);
        if (!followsDay) return NextResponse.json({ error: "A compensatory holiday cannot fall on a Sunday" }, { status: 400 });
        if (holiday.compensatoryDateKey && holiday.compensatoryDateKey <= dateKey) {
          return NextResponse.json({ error: "The holiday must stay before its compensatory Sunday" }, { status: 400 });
        }
        update.compensatoryFollowsDay = followsDay;
      }
      update.date = date;
      update.academicYear = academicYearForDate(date);
      edited = true;
    }
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
      await syncCompensatoryWorkingDay(db, session.collegeId, { id, name, enabled, dateKey });
      return NextResponse.json({ ok: true });
    }

    if (Object.keys(update).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    await docRef.update(update);
    // A live compensatory Sunday carries the holiday's name in its reason.
    if (edited && holiday.category === "BRIDGE" && holiday.compensatoryEnabled && holiday.compensatoryDateKey) {
      await syncCompensatoryWorkingDay(db, session.collegeId, { id, name, enabled: true, dateKey: holiday.compensatoryDateKey });
    }
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
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "ACADEMICS");
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
