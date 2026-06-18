export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET() {
  try {
    await requireSuperAdmin();
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
    await requireSuperAdmin();
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
