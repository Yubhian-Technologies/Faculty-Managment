export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { paymentErrorResponse, PAYMENT_MANAGER_ROLES } from "@/lib/payments/server";

// The colleges whose payments this Accounts login manages (its location), or every college for Super Admin.
export async function GET() {
  try {
    const session = await requireRole(...PAYMENT_MANAGER_ROLES);
    const db = getAdminDb();
    const col = db.collection("colleges");
    const docs = session.role === "SUPER_ADMIN"
      ? (await col.get()).docs
      : session.locationId
        ? (await col.where("locationId", "==", session.locationId).get()).docs
        : session.collegeId ? [await col.doc(session.collegeId).get()].filter((d) => d.exists) : [];
    const colleges = docs
      .map((d) => ({ id: d.id, name: String((d.data() as { name?: string } | undefined)?.name ?? d.id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ colleges });
  } catch (err) {
    return paymentErrorResponse(err, "[college/payments/colleges GET]");
  }
}
