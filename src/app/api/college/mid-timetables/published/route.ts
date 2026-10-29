export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { guardError } from "@/lib/midBank/server";
import { MID_TIMETABLE_VIEWERS, visibleTimetables } from "@/lib/midTimetable/server";

// The published Mid timetables the caller may see (students: their own branch;
// faculty: the branches they teach; HOD: also their departments; Exam Cell,
// Principal, VP: every branch). Read-only.

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...MID_TIMETABLE_VIEWERS);
    const list = await visibleTimetables(getAdminDb(), session);
    // ?exists=1: just whether there is one (the sidebar shows Mid Timetable only then).
    if (new URL(request.url).searchParams.get("exists") === "1") return NextResponse.json({ exists: list.length > 0 });
    list.sort((a, b) => b.midNumber - a.midNumber || a.courseName.localeCompare(b.courseName) || a.year - b.year || a.branch.localeCompare(b.branch));
    return NextResponse.json({ timetables: list });
  } catch (err) {
    return guardError(err, "[college/mid-timetables/published GET]");
  }
}
