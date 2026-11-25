export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { paymentErrorResponse } from "@/lib/payments/server";

// The colleges a location fee login (Accounts, Scholarship Cell) works on: its location's colleges, or every college
// for Super Admin - for the college picker on Fees / Scholarship Cell pages.
export async function GET() {
  try {
    const session = await requireRole("ACCOUNTS", "SCHOLARSHIP_CELL", "SUPER_ADMIN");
    const col = getAdminDb().collection("colleges");
    const docs = session.role === "SUPER_ADMIN" ? (await col.get()).docs
      : session.locationId ? (await col.where("locationId", "==", session.locationId).get()).docs : [];
    const colleges = docs.map((d) => ({ id: d.id, name: String((d.data() as { name?: string }).name ?? d.id) })).sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ colleges });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/colleges GET]");
  }
}
