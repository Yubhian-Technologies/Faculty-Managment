export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { validateLayeredRoom } from "@/lib/exams/seatingLayers";
import type { ExamSeatingPlan, SeatingRoomAllocation, SeatingStudent } from "@/types/examSeating";

type Ctx = { params: Promise<{ id: string }> };

const planRef = (collegeId: string, id: string) =>
  getAdminDb().collection("colleges").doc(collegeId).collection("examSeatingPlans").doc(id);

function isAuthError(err: unknown) {
  return err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT");
}

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL");
    const { id } = await params;
    const snap = await planRef(session.collegeId, id).get();
    if (!snap.exists) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    return NextResponse.json({ plan: { id: snap.id, ...snap.data() } });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (isAuthError(err)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[exam-seating/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Exam Cell's review step: save edited rooms/unplaced, rename, or publish. The
// same students must come back (nobody dropped or invented) and no room may
// exceed its capacity.
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const { id } = await params;
    const body = (await readJsonBody(request)) as {
      name?: string;
      status?: "DRAFT" | "PUBLISHED";
      rooms?: SeatingRoomAllocation[];
      unplaced?: SeatingStudent[];
    };
    const ref = planRef(session.collegeId, id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    const plan = snap.data() as ExamSeatingPlan;

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) {
      if (!body.name.trim()) return NextResponse.json({ error: "Exam name is required" }, { status: 400 });
      update.name = body.name.trim();
    }
    if (body.status) update.status = body.status;

    if (body.rooms || body.unplaced) {
      const rooms = body.rooms ?? plan.rooms;
      const unplaced = body.unplaced ?? plan.unplaced;
      const before = new Set([...plan.rooms.flatMap((r) => r.students), ...plan.unplaced].map((s) => s.id));
      const afterList = [...rooms.flatMap((r) => r.students), ...unplaced].map((s) => s.id);
      if (afterList.length !== before.size || afterList.some((sid) => !before.has(sid)) || new Set(afterList).size !== afterList.length) {
        return NextResponse.json({ error: "The edited plan doesn't match the original students" }, { status: 400 });
      }
      const capacityById = new Map(plan.rooms.map((r) => [r.roomId, r.capacity]));
      const deptBySection = new Map(plan.sections.map((s) => [s.id, s.department]));
      for (const r of rooms) {
        const cap = capacityById.get(r.roomId);
        if (cap === undefined) return NextResponse.json({ error: "Unknown room in plan" }, { status: 400 });
        if (r.students.length > cap) {
          return NextResponse.json({ error: `Room ${r.name} exceeds its capacity of ${cap}` }, { status: 400 });
        }
        if (plan.mode === "LAYERED") {
          const orig = plan.rooms.find((o) => o.roomId === r.roomId)!;
          const problem = validateLayeredRoom({ ...orig, students: r.students }, (sid) => deptBySection.get(sid) ?? "");
          if (problem) return NextResponse.json({ error: problem }, { status: 400 });
        }
      }
      // Only student placement is editable - room facts stay as snapshotted.
      update.rooms = plan.rooms.map((orig) => ({ ...orig, students: rooms.find((r) => r.roomId === orig.roomId)?.students ?? [] }));
      update.unplaced = unplaced;
    }
    if (update.status === "PUBLISHED" && ((update.unplaced as SeatingStudent[] | undefined) ?? plan.unplaced).length > 0) {
      return NextResponse.json({ error: "Place every student before publishing" }, { status: 400 });
    }

    await ref.update(update);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (isAuthError(err)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[exam-seating/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const { id } = await params;
    await planRef(session.collegeId, id).delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (isAuthError(err)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[exam-seating/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
