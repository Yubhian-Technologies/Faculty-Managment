export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { loadSectionStudents } from "@/lib/exams/seatingStudents";
import { sectionLabel } from "@/lib/exams/seatingSections";
import { placeInRoom } from "@/lib/exams/seatingLayers";
import type { Section } from "@/types";
import type { ExamSeatingPlan, SeatingSectionRef } from "@/types/examSeating";

type Ctx = { params: Promise<{ id: string }> };

// Layered plans: allot ONE section. Exam Cell has divided its students into
// groups (sized by the rooms' benches) and chosen a room for each group; this
// places every group into a free bench layer of its room, keeping one branch
// per layer so benchmates are always from different branches.
export async function POST(request: Request, { params }: Ctx) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const { id } = await params;
    const body = (await readJsonBody(request)) as { sectionId?: string; groups?: { roomId: string; studentIds: string[] }[] };
    if (!body.sectionId || !body.groups?.length) {
      return NextResponse.json({ error: "Pick a section and at least one group" }, { status: 400 });
    }

    const db = getAdminDb();
    const college = db.collection("colleges").doc(session.collegeId);
    const planRef = college.collection("examSeatingPlans").doc(id);
    const [planSnap, sectionSnap] = await Promise.all([planRef.get(), college.collection("sections").doc(body.sectionId).get()]);
    if (!planSnap.exists || !sectionSnap.exists) return NextResponse.json({ error: "Plan or section not found" }, { status: 404 });
    const plan = planSnap.data() as ExamSeatingPlan;
    if (plan.mode !== "LAYERED") return NextResponse.json({ error: "This plan isn't a layered plan" }, { status: 400 });
    if (plan.status === "PUBLISHED") return NextResponse.json({ error: "Unpublish is not supported - build a new plan" }, { status: 400 });

    const section = { id: sectionSnap.id, ...sectionSnap.data() } as Section;
    const students = await loadSectionStudents(db, session.collegeId, section);
    const byId = new Map(students.map((s) => [s.id, s]));
    const seated = new Set(plan.rooms.flatMap((r) => r.students.map((s) => s.id)));

    const sections: SeatingSectionRef[] = plan.sections.some((s) => s.id === section.id)
      ? plan.sections
      : [...plan.sections, {
          id: section.id, label: sectionLabel(section), department: section.department,
          year: section.year, name: section.name, studentCount: students.length,
        }];
    const deptBySection = new Map(sections.map((s) => [s.id, s.department]));
    const deptOf = (sectionId: string) => deptBySection.get(sectionId) ?? "";

    let rooms = plan.rooms;
    const usedNow = new Set<string>();
    for (const g of body.groups) {
      const picked = g.studentIds.map((sid) => byId.get(sid));
      if (picked.some((s) => !s)) return NextResponse.json({ error: "A student isn't part of this section" }, { status: 400 });
      if (g.studentIds.some((sid) => seated.has(sid) || usedNow.has(sid))) {
        return NextResponse.json({ error: "A student is already seated in this plan" }, { status: 400 });
      }
      g.studentIds.forEach((sid) => usedNow.add(sid));
      const room = rooms.find((r) => r.roomId === g.roomId);
      if (!room) return NextResponse.json({ error: "Room is not part of this plan" }, { status: 400 });
      const placed = placeInRoom(room, picked as NonNullable<(typeof picked)[number]>[], section.department, deptOf);
      if ("error" in placed) return NextResponse.json({ error: placed.error }, { status: 400 });
      rooms = rooms.map((r) => (r.roomId === g.roomId ? placed.room : r));
    }

    await planRef.update({ rooms, sections, updatedAt: new Date() });
    return NextResponse.json({ ok: true, seated: usedNow.size });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[exam-seating/[id]/allot POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
