export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { examRoomDocId, sortRoomsForSeating } from "@/lib/exams/seatingAllocator";
import type { ExamRoom } from "@/types/examSeating";

const READ_ROLES = ["COLLEGE_OFFICE", "EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL"];
const MAX_ROOMS_PER_REQUEST = 500;

const roomsCol = (collegeId: string) =>
  getAdminDb().collection("colleges").doc(collegeId).collection("examRooms");

export async function GET() {
  try {
    const session = await requireCollegeMember(...READ_ROLES);
    const snap = await roomsCol(session.collegeId).get();
    const rooms = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ExamRoom);
    return NextResponse.json({ rooms: sortRoomsForSeating(rooms) });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[exam-rooms GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// One room or a whole uploaded sheet: { rooms: [{ name, block, floor, capacity }] }.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");
    const body = (await request.json()) as {
      rooms?: { name?: string; block?: string; floor?: number | string; capacity?: number | string }[];
    };
    const input = body.rooms ?? [];
    if (input.length === 0) return NextResponse.json({ error: "No rooms provided" }, { status: 400 });
    if (input.length > MAX_ROOMS_PER_REQUEST) {
      return NextResponse.json({ error: `At most ${MAX_ROOMS_PER_REQUEST} rooms per upload` }, { status: 400 });
    }

    const errors: string[] = [];
    const clean = new Map<string, { name: string; block: string; floor: number; capacity: number }>();
    input.forEach((r, i) => {
      const name = String(r.name ?? "").trim();
      const block = String(r.block ?? "").trim();
      const floor = Number(r.floor);
      const capacity = Number(r.capacity);
      if (!name || !block || !Number.isFinite(floor) || !Number.isInteger(capacity) || capacity < 1) {
        errors.push(`Row ${i + 1}: name, block, floor and a capacity of at least 1 are required`);
        return;
      }
      clean.set(examRoomDocId(block, name), { name, block, floor, capacity });
    });
    if (errors.length > 0) return NextResponse.json({ error: errors.slice(0, 5).join("; ") }, { status: 400 });

    const db = getAdminDb();
    const col = roomsCol(session.collegeId);
    const batch = db.batch();
    const now = new Date();
    for (const [id, room] of clean) {
      batch.set(col.doc(id), { collegeId: session.collegeId, ...room, isActive: true, updatedAt: now, createdAt: now }, { merge: true });
    }
    await batch.commit();
    return NextResponse.json({ saved: clean.size }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[exam-rooms POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
