import { NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { buildRecordProfile } from "@/lib/mentoring/profileRecord";
import { entriesCol, loadProfileOverrides, toEntry } from "@/lib/mentoring/recordStore";
import { buildSemesterSheet, loadSemesterOptions } from "@/lib/mentoring/semesterSheet";
import { visibleToStudent } from "@/lib/mentoring/studentView";
import type { StudentRecord } from "@/types";

// The read-only Mentoring Record parts, shared by the two readers who are not the mentor: the
// student (student/me/mentoring) and the Principal / Vice-Principal (mentoring/college-students/[id]).
// Same parts as the mentor's route (mentoring/students/[id]) - record, semesters, sheet, entries -
// minus what the booklet keeps for the mentor and HOD alone (referrals, health record, semester
// remarks; see studentView.ts). Returns null for any other part so the caller can answer its own.
export async function readOnlyRecordPart(
  db: Firestore,
  collegeId: string,
  student: StudentRecord & { id: string },
  part: string,
  searchParams: URLSearchParams
): Promise<NextResponse | null> {
  switch (part) {
    case "record": {
      const overrides = await loadProfileOverrides(db, collegeId, student.id);
      return NextResponse.json(buildRecordProfile(student as unknown as Record<string, unknown>, overrides, false));
    }
    case "semesters":
      return NextResponse.json({ semesters: await loadSemesterOptions(db, collegeId, student) });
    case "sheet": {
      const sem = searchParams.get("semester");
      if (sem == null || !/^\d{1,2}$/.test(sem)) return NextResponse.json({ error: "semester is required" }, { status: 400 });
      const sheet = await buildSemesterSheet(db, collegeId, student, Number(sem));
      if (!sheet) return NextResponse.json({ error: "No such semester yet" }, { status: 404 });
      return NextResponse.json({ sheet: { ...sheet, remarks: null } });
    }
    case "entries": {
      const snap = await entriesCol(db, collegeId, student.id).limit(1000).get();
      return NextResponse.json({ entries: visibleToStudent(snap.docs.map(toEntry)) });
    }
    default:
      return null;
  }
}
