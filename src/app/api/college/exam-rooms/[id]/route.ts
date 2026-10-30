export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { columnsError } from "@/lib/exams/roomLayout";

type Ctx = { params: Promise<{ id: string }> };

function unauthorized(err: unknown) {
  return err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT");
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const { id } = await params;
    const body = (await readJsonBody(request)) as { name?: string; block?: string; floor?: number; benches?: number; studentsPerBench?: number; columns?: number | string | null; isActive?: boolean };
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) {
      if (!body.name.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
      update.name = body.name.trim();
    }
    if (body.block !== undefined) {
      if (!body.block.trim()) return NextResponse.json({ error: "Block is required" }, { status: 400 });
      update.block = body.block.trim();
    }
    if (body.floor !== undefined) {
      if (!Number.isFinite(Number(body.floor))) return NextResponse.json({ error: "Floor must be a number" }, { status: 400 });
      update.floor = Number(body.floor);
    }
    if (body.benches !== undefined) {
      if (!Number.isInteger(Number(body.benches)) || Number(body.benches) < 1) {
        return NextResponse.json({ error: "Benches must be at least 1" }, { status: 400 });
      }
      update.benches = Number(body.benches);
    }
    if (body.studentsPerBench !== undefined) {
      const n = Number(body.studentsPerBench);
      if (!Number.isInteger(n) || n < 1 || n > 3) {
        return NextResponse.json({ error: "Students per bench must be 1, 2 or 3" }, { status: 400 });
      }
      update.studentsPerBench = n;
    }
    if (body.isActive !== undefined) update.isActive = !!body.isActive;

    const ref = getAdminDb().collection("colleges").doc(session.collegeId).collection("examRooms").doc(id);
    const existing = await ref.get();
    if (!existing.exists) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    const cur = existing.data() as { benches?: number; studentsPerBench?: number; columns?: number; capacity?: number };
    // Columns: blank / null clears them; otherwise 1 .. the room's benches (checked against new benches too).
    const benchesNow = Number(update.benches ?? cur.benches ?? cur.capacity ?? 1);
    if (body.columns !== undefined) {
      const raw = String(body.columns ?? "").trim();
      if (!raw) update.columns = FieldValue.delete();
      else {
        const problem = columnsError(Number(raw), benchesNow);
        if (problem) return NextResponse.json({ error: problem }, { status: 400 });
        update.columns = Number(raw);
      }
    } else if (update.benches !== undefined && cur.columns && cur.columns > benchesNow) {
      return NextResponse.json({ error: "Columns can't be more than the benches" }, { status: 400 });
    }
    if (update.benches !== undefined || update.studentsPerBench !== undefined) {
      update.capacity = Number(update.benches ?? cur.benches ?? cur.capacity ?? 1) * Number(update.studentsPerBench ?? cur.studentsPerBench ?? 1);
    }
    await ref.update(update);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (unauthorized(err)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[exam-rooms PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const { id } = await params;
    // Existing seating plans embed a snapshot of the room, so deleting it
    // never rewrites a plan that was already made.
    await getAdminDb().collection("colleges").doc(session.collegeId).collection("examRooms").doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (unauthorized(err)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[exam-rooms DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
