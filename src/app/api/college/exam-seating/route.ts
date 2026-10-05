export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { allocateSeating, sortRoomsForSeating } from "@/lib/exams/seatingAllocator";
import { sectionLabel } from "@/lib/exams/seatingSections";
import { loadSectionStudents } from "@/lib/exams/seatingStudents";
import { roomBenches, roomPerBench } from "@/lib/exams/roomLayout";
import type { Section } from "@/types";
import type { ExamRoom, ExamSeatingPlan, SeatingRoomAllocation, SeatingSectionRef } from "@/types/examSeating";

const ROLES = ["EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL"];

function isAuthError(err: unknown) {
  return err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT");
}

export async function GET() {
  try {
    const session = await requireCollegeMember(...ROLES);
    const snap = await getAdminDb().collection("colleges").doc(session.collegeId).collection("examSeatingPlans").get();
    const plans = snap.docs
      .map((d) => {
        const p = { id: d.id, ...d.data() } as ExamSeatingPlan & { createdAt?: { toMillis?: () => number } | Date };
        const at = p.createdAt instanceof Date ? p.createdAt.getTime() : p.createdAt?.toMillis?.() ?? 0;
        return {
          id: p.id, name: p.name, status: p.status, createdByName: p.createdByName,
          roomCount: p.rooms.filter((r) => r.students.length > 0).length,
          studentCount: p.rooms.reduce((n, r) => n + r.students.length, 0),
          unplacedCount: p.unplaced.length, at,
        };
      })
      .sort((a, b) => b.at - a.at);
    return NextResponse.json({ plans });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (isAuthError(err)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[exam-seating GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Builds a DRAFT plan: the exam's name, the sections taking it (in the order
// Exam Cell listed them), the rooms in use, and optionally the sections
// handpicked for particular rooms. Students are then placed automatically -
// Exam Cell reviews/edits before publishing (PATCH [id]).
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const body = (await readJsonBody(request)) as {
      name?: string;
      sectionIds?: string[];
      roomIds?: string[];
      roomSections?: Record<string, string[]>;
      // LAYERED starts empty (sections are allotted one by one afterwards).
      mode?: "QUICK" | "LAYERED";
    };
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: "Exam name is required" }, { status: 400 });
    const layered = body.mode === "LAYERED";
    if (!layered && !body.sectionIds?.length) return NextResponse.json({ error: "Pick at least one section" }, { status: 400 });
    if (!body.roomIds?.length) return NextResponse.json({ error: "Pick at least one room" }, { status: 400 });

    const db = getAdminDb();
    const college = db.collection("colleges").doc(session.collegeId);

    const sectionIds = body.sectionIds ?? [];
    const [sectionSnaps, roomSnaps] = await Promise.all([
      Promise.all(sectionIds.map((id) => college.collection("sections").doc(id).get())),
      Promise.all(body.roomIds.map((id) => college.collection("examRooms").doc(id).get())),
    ]);
    const sections = sectionSnaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() }) as Section);
    const rooms = roomSnaps.filter((r) => r.exists).map((r) => ({ id: r.id, ...r.data() }) as ExamRoom);
    if (rooms.length === 0 || (!layered && sections.length === 0)) {
      return NextResponse.json({ error: "Selected sections or rooms no longer exist" }, { status: 400 });
    }

    const studentsBySection = await Promise.all(sections.map((s) => loadSectionStudents(db, session.collegeId, s)));

    const validSectionIds = new Set(sections.map((s) => s.id));
    const allocation = allocateSeating(
      rooms.map((r) => ({
        // Quick fill seats one student per bench - a lone branch never sits two to a bench.
        roomId: r.id, name: r.name, block: r.block, floor: r.floor, capacity: roomBenches(r),
        allowedSectionIds: (body.roomSections?.[r.id] ?? []).filter((id) => validSectionIds.has(id)),
      })),
      // Listed order = seating order, so use the order Exam Cell sent.
      sectionIds
        .map((id) => sections.findIndex((s) => s.id === id))
        .filter((i) => i >= 0)
        .map((i) => ({ id: sections[i].id, students: studentsBySection[i] }))
    );

    let actorName = session.email || "Exam Cell";
    try {
      const me = await college.collection("users").doc(session.uid).get();
      actorName = (me.data() as { name?: string } | undefined)?.name ?? actorName;
    } catch { /* keep the fallback */ }

    const sectionRefs: SeatingSectionRef[] = sections.map((s, i) => ({
      id: s.id, label: sectionLabel(s), department: s.department, year: s.year, name: s.name,
      studentCount: studentsBySection[i].length,
    }));
    const now = new Date();
    const plan: Omit<ExamSeatingPlan, "id"> = {
      collegeId: session.collegeId,
      name,
      status: "DRAFT",
      sections: sectionRefs,
      mode: layered ? "LAYERED" : "QUICK",
      rooms: layered
        ? sortRoomsForSeating(rooms).map((r): SeatingRoomAllocation => ({
            roomId: r.id, name: r.name, block: r.block, floor: r.floor,
            capacity: roomBenches(r) * roomPerBench(r), benches: roomBenches(r), perBench: roomPerBench(r), students: [],
          }))
        : allocation.rooms.map((r) => (r.allowedSectionIds?.length ? r : { ...r, allowedSectionIds: [] })),
      unplaced: allocation.unplaced,
      createdBy: session.uid,
      createdByName: actorName,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await college.collection("examSeatingPlans").add(plan);
    return NextResponse.json({ id: ref.id, unplaced: allocation.unplaced.length }, { status: 201 });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (isAuthError(err)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[exam-seating POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
