export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Self-contained read for the Class Leader dashboard: resolves the caller's
// own bound Section (never a client-supplied id) and returns everything the
// timetable grid needs in one call. Reads TimetableSlot docs live on every
// request (no caching layer) so any reassignment HOD makes via the Teaching
// Assignments editor shows up here immediately.
export async function GET() {
  try {
    const session = await requireCollegeMember("CLASS_LEADER");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const userSnap = await collegeRef.collection("users").doc(session.uid).get();
    const sectionId = (userSnap.data() as { sectionId?: string } | undefined)?.sectionId;
    if (!sectionId) {
      return NextResponse.json({ error: "No section is linked to this login" }, { status: 404 });
    }

    const sectionSnap = await collegeRef.collection("sections").doc(sectionId).get();
    if (!sectionSnap.exists) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }
    const section = { id: sectionSnap.id, ...sectionSnap.data() } as { id: string; courseId: string; year: number };

    const [courseSnap, timingsSnap, slotsSnap] = await Promise.all([
      collegeRef.collection("courses").doc(section.courseId).get(),
      collegeRef.collection("courseYearTimings").where("courseId", "==", section.courseId).get(),
      collegeRef.collection("timetableSlots").where("sectionId", "==", sectionId).get(),
    ]);

    const course = courseSnap.exists ? { id: courseSnap.id, ...courseSnap.data() } : null;
    const timing = timingsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as unknown as { id: string; year: number })
      .find((t) => t.year === section.year) ?? null;
    const slots = slotsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({ course, section, timing, slots });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/class-leader/timetable GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
