export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { guardError } from "@/lib/midBank/server";
import { roomBenches, roomPerBench } from "@/lib/exams/roomLayout";
import { sectionLabel } from "@/lib/exams/seatingSections";
import { allocatePaired } from "@/lib/exams/seatingPaired";
import { groupStudents, midGroups, midSources } from "@/lib/exams/seatingPairedServer";
import type { ExamRoom, ExamSeatingPlan, SeatingSectionRef, SeatingStream } from "@/types/examSeating";

// Exam Cell: a PAIRED seating plan from the Mid timetable - one arrangement
// for every exam day of the Mid.
//   GET                   -> the Mid timetables (course + year + semester + Mid) with branches
//   GET ?planIds=a,b      -> the groups (branch + year) of those timetables, with sections and counts
//   POST                  -> build the plan: each seat position's stream of groups, rooms in the order picked

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const db = getAdminDb();
    const q = new URL(request.url).searchParams;
    const planIds = (q.get("planIds") ?? "").split(",").filter(Boolean);
    if (planIds.length === 0) return NextResponse.json({ mids: await midSources(db, session.collegeId) });
    const groups = await midGroups(db, session.collegeId, planIds);
    const withCounts = await Promise.all(groups.map(async (g) => {
      const students = await groupStudents(db, session.collegeId, g);
      return {
        key: g.key, label: g.label, courseName: g.courseName, year: g.year, branch: g.branch, subjects: g.subjects, count: students.length,
        sections: g.sections.map((s) => ({ id: s.id, name: s.name, count: students.filter((x) => x.sectionId === s.id).length })),
      };
    }));
    return NextResponse.json({ groups: withCounts });
  } catch (err) {
    return guardError(err, "[college/exam-seating/paired GET]");
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const body = (await readJsonBody(request)) as { name?: string; planIds?: unknown; streams?: unknown; roomIds?: unknown };
    const name = String(body.name ?? "").trim();
    const planIds = (Array.isArray(body.planIds) ? body.planIds : []).map(String).filter(Boolean);
    if (!name) return NextResponse.json({ error: "Exam name is required" }, { status: 400 });
    if (planIds.length === 0) return NextResponse.json({ error: "Pick the Mid timetable" }, { status: 400 });
    const streamKeys = (Array.isArray(body.streams) ? body.streams : []).map((x) => (Array.isArray(x) ? x.map(String) : [])).filter((x) => x.length);
    if (streamKeys.length === 0) return NextResponse.json({ error: "Put at least one branch in Seat A" }, { status: 400 });
    const all = streamKeys.flat();
    if (new Set(all).size !== all.length) return NextResponse.json({ error: "A branch can sit in only one seat position" }, { status: 400 });
    const roomIds = (Array.isArray(body.roomIds) ? body.roomIds : []).map(String);
    if (roomIds.length === 0) return NextResponse.json({ error: "Pick at least one room" }, { status: 400 });

    const db = getAdminDb();
    const college = db.collection("colleges").doc(session.collegeId);
    const [groups, roomSnaps, sources] = await Promise.all([
      midGroups(db, session.collegeId, planIds),
      Promise.all(roomIds.map((id) => college.collection("examRooms").doc(id).get())),
      midSources(db, session.collegeId),
    ]);
    const byKey = new Map(groups.map((g) => [g.key, g]));
    const missing = all.filter((k) => !byKey.has(k));
    if (missing.length) return NextResponse.json({ error: "A branch is no longer in that Mid timetable - reload" }, { status: 400 });
    const rooms = roomSnaps.filter((r) => r.exists).map((r) => ({ id: r.id, ...(r.data() as Omit<ExamRoom, "id">) }));
    if (rooms.length === 0) return NextResponse.json({ error: "The rooms picked no longer exist" }, { status: 400 });

    const studentsByKey = new Map(await Promise.all(all.map(async (k) => [k, await groupStudents(db, session.collegeId, byKey.get(k)!)] as const)));
    const streams = streamKeys.map((keys) => keys.flatMap((k) => studentsByKey.get(k)!));
    const allocation = allocatePaired(
      rooms.map((r) => ({ roomId: r.id, name: r.name, block: r.block, floor: r.floor, benches: roomBenches(r), perBench: roomPerBench(r) })),
      streams,
    );
    if (allocation.rooms.every((r) => r.perBench! < streamKeys.length)) {
      return NextResponse.json({ error: `The rooms picked have fewer than ${streamKeys.length} seats per bench` }, { status: 400 });
    }

    const used = all.map((k) => byKey.get(k)!);
    const sectionRefs: SeatingSectionRef[] = used.flatMap((g) => g.sections.map((s) => ({
      id: s.id, label: sectionLabel(s), department: s.department, year: s.year, name: s.name,
      studentCount: studentsByKey.get(g.key)!.filter((x) => x.sectionId === s.id).length,
    })));
    const streamRefs: SeatingStream[] = streamKeys.map((keys, i) => ({ seat: i + 1, groups: keys.map((k) => ({ key: k, label: byKey.get(k)!.label, count: studentsByKey.get(k)!.length })) }));
    const me = await college.collection("users").doc(session.uid).get();
    const now = new Date();
    const plan: Omit<ExamSeatingPlan, "id"> = {
      collegeId: session.collegeId, name, status: "DRAFT", mode: "PAIRED",
      sections: sectionRefs, rooms: allocation.rooms, unplaced: allocation.unplaced,
      midPlanIds: planIds,
      examDays: [...new Set(sources.filter((x) => planIds.includes(x.id)).flatMap((x) => x.days))].sort(),
      examTime: [...new Set(sources.filter((x) => planIds.includes(x.id)).map((x) => x.time).filter(Boolean))].length === 1 ? sources.find((x) => planIds.includes(x.id) && x.time)!.time : "",
      streams: streamRefs,
      createdBy: session.uid, createdByName: (me.data() as { name?: string } | undefined)?.name ?? session.email ?? "Exam Cell",
      createdAt: now, updatedAt: now,
    };
    const ref = await college.collection("examSeatingPlans").add(plan);
    return NextResponse.json({ id: ref.id, unplaced: allocation.unplaced.length }, { status: 201 });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/exam-seating/paired POST]");
  }
}
