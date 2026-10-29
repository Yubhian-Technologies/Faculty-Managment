export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { istDateKey } from "@/lib/attendance/istTime";
import { notifyRole } from "@/lib/notify";
import { academicYearForDate, syncCompensatoryWorkingDay } from "@/lib/college/compensatorySync";
import { isDateKey, isSundayKey, weekdayOfKey } from "@/lib/college/holidayCalendar";
import type { Holiday, HolidayAudience, HolidayCategory, HolidayType } from "@/types";

const HOLIDAY_TYPES: HolidayType[] = ["NATIONAL", "REGIONAL", "COLLEGE", "RESTRICTED"];
const HOLIDAY_AUDIENCES: HolidayAudience[] = ["STUDENTS", "BOTH"];
const HOLIDAY_CATEGORIES: HolidayCategory[] = ["REGULAR", "BRIDGE", "CLASS_SUSPENDED"];

// Academic Calendar Holidays - maintained by Office (Principal/VP too, same as
// firestore.rules' isPrincipalOrOffice) so the Leave History Report's
// "Holidays" column (see leave-history-report/route.ts) has something real to
// count instead of a bare "-", and so LeaveApplyForm's live day-count preview
// can exclude them client-side same as the server does (applications/route.ts
// POST queries Firestore directly, so it isn't gated by this role list - this
// is just for the preview to agree with it). Read is open to every role that
// can apply for leave - see applications/route.ts GET's own role list.
export async function GET() {
  try {
    const session = await requireCollegeMember(
      "STUDENT", "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "ACADEMICS", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "HOSTEL", "PD", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
    );
    const db = getAdminDb();
    const snap = await db
      .collection("colleges").doc(session.collegeId).collection("holidays")
      .orderBy("date", "asc")
      .get();
    const holidays = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Holiday);
    return NextResponse.json({ holidays });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/holidays GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "ACADEMICS", "COLLEGE_OFFICE");
    const body = (await readJsonBody(request)) as {
      date?: string; name?: string; type?: HolidayType; appliesTo?: HolidayAudience;
      category?: HolidayCategory; hostelersOutingAllowed?: boolean;
      compensatoryDateKey?: string; compensatoryEnabled?: boolean;
    };

    const category: HolidayCategory = body.category ?? "REGULAR";
    if (!HOLIDAY_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: "Invalid holiday category" }, { status: 400 });
    }
    // Only the yearly list carries a National/Regional/... type; the other
    // categories are always filed as College.
    const type: HolidayType | undefined = category === "REGULAR" ? body.type : "COLLEGE";
    if (!body.date || !body.name?.trim() || !type) {
      return NextResponse.json({ error: "date, name and type are required" }, { status: 400 });
    }
    if (!HOLIDAY_TYPES.includes(type)) {
      return NextResponse.json({ error: "Invalid holiday type" }, { status: 400 });
    }
    if (body.appliesTo != null && !HOLIDAY_AUDIENCES.includes(body.appliesTo)) {
      return NextResponse.json({ error: "Invalid audience" }, { status: 400 });
    }
    if (category === "CLASS_SUSPENDED" && !body.appliesTo) {
      return NextResponse.json({ error: "Choose whether faculty are affected too" }, { status: 400 });
    }
    if (body.hostelersOutingAllowed != null && typeof body.hostelersOutingAllowed !== "boolean") {
      return NextResponse.json({ error: "Invalid hostellers outing value" }, { status: 400 });
    }
    const date = new Date(body.date);
    if (Number.isNaN(date.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    const dateKey = isDateKey(body.date) ? body.date : istDateKey(date);

    // A bridge holiday is for everyone. Its optional compensatory Sunday runs
    // the bridged weekday's timetable, but stays an ordinary day off until the
    // Principal switches it on.
    let compensatory: Record<string, unknown> = {};
    if (category === "BRIDGE") {
      const followsDay = weekdayOfKey(dateKey);
      if (!followsDay) return NextResponse.json({ error: "A compensatory holiday cannot fall on a Sunday" }, { status: 400 });
      if (body.compensatoryDateKey) {
        if (!isDateKey(body.compensatoryDateKey) || !isSundayKey(body.compensatoryDateKey) || body.compensatoryDateKey <= dateKey) {
          return NextResponse.json({ error: "The compensatory day must be a Sunday after the holiday" }, { status: 400 });
        }
        compensatory = {
          compensatoryDateKey: body.compensatoryDateKey,
          compensatoryFollowsDay: followsDay,
          compensatoryEnabled: (session.role === "PRINCIPAL" || session.role === "VICE_PRINCIPAL") && body.compensatoryEnabled === true,
        };
      }
    }

    const db = getAdminDb();
    const now = new Date();
    const docRef = db.collection("colleges").doc(session.collegeId).collection("holidays").doc();
    await docRef.set({
      collegeId: session.collegeId,
      date,
      name: body.name.trim(),
      type,
      appliesTo: category === "BRIDGE" ? "BOTH" : body.appliesTo ?? "BOTH",
      category,
      ...(body.hostelersOutingAllowed != null ? { hostelersOutingAllowed: body.hostelersOutingAllowed } : {}),
      ...compensatory,
      academicYear: academicYearForDate(date),
      createdAt: now,
    });
    if (compensatory.compensatoryEnabled === true) {
      await syncCompensatoryWorkingDay(db, session.collegeId, {
        id: docRef.id, name: body.name.trim(), enabled: true, dateKey: compensatory.compensatoryDateKey as string,
      });
    } else if (compensatory.compensatoryDateKey) {
      // Waiting on the Principal's yes/no.
      for (const role of ["PRINCIPAL", "VICE_PRINCIPAL"]) {
        await notifyRole(
          db, session.collegeId, role, "COMPENSATORY_SUNDAY_PENDING",
          "Compensatory Sunday needs a decision",
          `${body.name.trim()} is a compensatory holiday. Decide whether ${compensatory.compensatoryDateKey} is a working day.`,
          "/principal/holidays"
        );
      }
    }

    return NextResponse.json({ id: docRef.id }, { status: 201 });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/holidays POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
