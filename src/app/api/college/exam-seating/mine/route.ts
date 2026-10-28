export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { guardError } from "@/lib/midBank/server";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { findOwnStudent } from "@/lib/students/ownContext";
import { rollRangeBySection } from "@/lib/exams/seatingAllocator";
import { SEAT_LETTERS } from "@/lib/exams/seatingPaired";
import { seatingWhen } from "@/lib/pdf/examSeatingTemplate";
import type { TeachingAssignment } from "@/types";
import type { ExamSeatingPlan } from "@/types/examSeating";

// Published exam seating for the caller (read-only):
//   STUDENT              -> their own seat in each published plan (room, bench, seat)
//   PANEL_MEMBER / HOD   -> the rooms where students of the sections they teach sit

export async function GET() {
  try {
    const session = await requireCollegeMember("STUDENT", "PANEL_MEMBER", "HOD");
    const db = getAdminDb();
    const college = db.collection("colleges").doc(session.collegeId);
    const plans = (await college.collection("examSeatingPlans").where("status", "==", "PUBLISHED").get()).docs
      .map((d) => ({ ...(d.data() as ExamSeatingPlan), id: d.id }))
      .sort((a, b) => (b.examDays?.[0] ?? b.examDate ?? "").localeCompare(a.examDays?.[0] ?? a.examDate ?? ""));
    const head = (p: ExamSeatingPlan) => ({ planId: p.id, exam: p.name, when: seatingWhen(p) });

    if (session.role === "STUDENT") {
      const own = await findOwnStudent(db, session.collegeId, session.uid);
      if (!own.ok) return NextResponse.json({ seats: [] });
      const seats = plans.flatMap((p) => p.rooms.flatMap((r) => {
        const me = r.students.find((s) => s.id === own.student.id);
        if (!me) return [];
        const seat = me.bench ? `${me.bench}${(r.perBench ?? 1) > 1 ? SEAT_LETTERS[(me.layer ?? 1) - 1] : ""}` : String(r.students.indexOf(me) + 1);
        return [{ ...head(p), room: r.name, block: r.block, floor: r.floor, seat, rollNumber: me.rollNumber }];
      }));
      return NextResponse.json({ seats });
    }

    const facultyId = await resolveFacultyMemberId(db, session.collegeId, session.uid);
    if (!facultyId) return NextResponse.json({ rooms: [] });
    const tas = (await college.collection("teachingAssignments").where("facultyId", "==", facultyId).get()).docs
      .map((d) => d.data() as TeachingAssignment).filter((t) => !t.isPast && t.sectionId);
    const mine = new Set(tas.map((t) => t.sectionId!));
    const rooms = plans.flatMap((p) => p.rooms.flatMap((r) => {
      const ours = r.students.filter((s) => mine.has(s.sectionId));
      return ours.length ? [{ ...head(p), room: r.name, block: r.block, floor: r.floor, total: r.students.length, sections: rollRangeBySection(ours) }] : [];
    }));
    return NextResponse.json({ rooms });
  } catch (err) {
    return guardError(err, "[college/exam-seating/mine GET]");
  }
}
