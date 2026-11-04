export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure, readJson } from "@/lib/certifications/http";
import { ADMIN_ROLES } from "@/lib/certifications/configured";
import { saveType } from "@/lib/certifications/configRoutes";

export async function POST(request: Request) {
  try {
    const session = await authenticate(...ADMIN_ROLES);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const type = await saveType(db, user, await readJson(request));
    return NextResponse.json({ type }, { status: 201 });
  } catch (err) {
    return failure(err, "certificate-config/types POST");
  }
}
