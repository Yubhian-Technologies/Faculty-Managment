export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure, readJson } from "@/lib/certifications/http";
import { ADMIN_ROLES, revokeIssued } from "@/lib/certifications/configured";

// Principal / College Admin / VP withdraw an issued certificate (issued by mistake, wrong details). It stays in
// the register, marked revoked, and its QR check says so.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await authenticate(...ADMIN_ROLES);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const body = (await readJson(request)) as { reason?: unknown };
    const certificate = await revokeIssued(db, user, id, typeof body.reason === "string" ? body.reason : "");
    return NextResponse.json({ certificate });
  } catch (err) {
    return failure(err, "certificates/[id]/revoke POST");
  }
}
