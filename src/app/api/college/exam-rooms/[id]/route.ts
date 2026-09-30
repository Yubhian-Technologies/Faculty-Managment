export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

type Ctx = { params: Promise<{ id: string }> };

function unauthorized(err: unknown) {
  return err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT");
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");
    const { id } = await params;
    const body = (await request.json()) as { name?: string; block?: string; floor?: number; capacity?: number; isActive?: boolean };
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
    if (body.capacity !== undefined) {
      if (!Number.isInteger(Number(body.capacity)) || Number(body.capacity) < 1) {
        return NextResponse.json({ error: "Capacity must be at least 1" }, { status: 400 });
      }
      update.capacity = Number(body.capacity);
    }
    if (body.isActive !== undefined) update.isActive = !!body.isActive;

    const ref = getAdminDb().collection("colleges").doc(session.collegeId).collection("examRooms").doc(id);
    if (!(await ref.get()).exists) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    await ref.update(update);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (unauthorized(err)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[exam-rooms PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");
    const { id } = await params;
    // Existing seating plans embed a snapshot of the room, so deleting it
    // never rewrites a plan that was already made.
    await getAdminDb().collection("colleges").doc(session.collegeId).collection("examRooms").doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (unauthorized(err)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[exam-rooms DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
