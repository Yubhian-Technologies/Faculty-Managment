export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { provisionLocationUser, type NewUserInput } from "@/lib/firestore/userProvisioning";
import type { UserRole } from "@/types";

// L2 roles Management may optionally staff onto a new location alongside the
// mandatory Administrator. Kept identical to MANAGEMENT_CREATABLE (minus
// ADMINISTRATION, which is mandatory) in admin/users/route.ts — Management
// only ever directly appoints Administration/Accounts; the rest of L2
// (HR Admin, Admin Office, Dept Head) is Administration's own hire.
const OPTIONAL_L2_ROLES: UserRole[] = ["ACCOUNTS"];

// SUPER_ADMIN (L0) and MANAGEMENT (L1, global) can both view/create locations —
// Management gained location-creation rights so it can act as a real L1 role
// per the org hierarchy (creates locations, assigns Administrators to them).
// PURCHASE_DEPT and FINANCE are read-only here — they only need the list to
// populate their Location → College → Department browse views.
export async function GET() {
  try {
    await requireRole("SUPER_ADMIN", "MANAGEMENT", "PURCHASE_DEPT", "FINANCE");
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
    const session = await requireRole("SUPER_ADMIN", "MANAGEMENT");
    const body = (await request.json()) as {
      name: string;
      city: string;
      state?: string;
      address?: string;
      administrationUser?: NewUserInput;
      additionalUsers?: (NewUserInput & { role: UserRole })[];
    };
    const { name, city, state, address, administrationUser, additionalUsers } = body;
    if (!name || !city) {
      return NextResponse.json({ error: "name and city required" }, { status: 400 });
    }

    // Management must staff the location with an Administrator in the same
    // request — Super Admin may still create a bare location (existing flow).
    if (session.role === "MANAGEMENT") {
      if (!administrationUser?.name || !administrationUser?.email || !administrationUser?.password) {
        return NextResponse.json(
          { error: "administrationUser (name, email, password) is required" },
          { status: 400 }
        );
      }
    }

    if (additionalUsers?.some((u) => !OPTIONAL_L2_ROLES.includes(u.role))) {
      return NextResponse.json(
        { error: `additionalUsers role must be one of: ${OPTIONAL_L2_ROLES.join(", ")}` },
        { status: 400 }
      );
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

    const provisioned: { role: UserRole; uid: string }[] = [];
    try {
      if (administrationUser?.email) {
        const uid = await provisionLocationUser(db, ref.id, "ADMINISTRATION", administrationUser);
        provisioned.push({ role: "ADMINISTRATION", uid });
      }
      for (const u of additionalUsers ?? []) {
        const uid = await provisionLocationUser(db, ref.id, u.role, u);
        provisioned.push({ role: u.role, uid });
      }
    } catch (provisionErr) {
      // Location was created but a nested user failed — surface partial success
      // rather than silently losing the location, so the caller can retry just
      // the missing user via admin/users instead of re-creating the location.
      const msg = provisionErr instanceof Error ? provisionErr.message : String(provisionErr);
      return NextResponse.json(
        { id: ref.id, provisioned, error: `Location created, but user provisioning failed: ${msg}` },
        { status: 207 }
      );
    }

    return NextResponse.json({ id: ref.id, provisioned }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/locations POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
