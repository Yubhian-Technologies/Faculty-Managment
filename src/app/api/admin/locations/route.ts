export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// SUPER_ADMIN (L0) and MANAGEMENT (L1, global) can both view/create locations —
// Management gained location-creation rights so it can act as a real L1 role
// per the org hierarchy (creates locations, assigns Administrators to them).
export async function GET() {
  try {
    await requireRole("SUPER_ADMIN", "MANAGEMENT");
    const db = getAdminDb();
    const snap = await db.collection("locations").orderBy("name").get();
    const locations = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ locations });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/locations GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireRole("SUPER_ADMIN", "MANAGEMENT");
    const body = (await request.json()) as {
      name: string;
      city: string;
      state?: string;
      address?: string;
    };
    const { name, city, state, address } = body;
    if (!name || !city) {
      return NextResponse.json({ error: "name and city required" }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date();
    const ref = await db.collection("locations").add({
      name: name.trim(),
      city: city.trim(),
      state: state?.trim() ?? "",
      address: address?.trim() ?? "",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/locations POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
