export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";
import { generatePassword } from "@/lib/firestore/facultyProvisioning";

// Deliberately dedicated to exactly one action (reset password) rather than
// folded into the general PATCH /api/college/users/[uid] route - Webmaster's
// scope here is intentionally unrestricted (any role in the college, including
// Principal), so keeping it single-purpose avoids also opening up profile edits.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("WEBMASTER", "SUPER_ADMIN");
    const body = (await request.json()) as { uid?: string };
    if (!body.uid) {
      return NextResponse.json({ error: "uid is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const targetSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(body.uid).get();
    if (!targetSnap.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const target = targetSnap.data() as { role?: string; name?: string };

    const generatedPassword = generatePassword();
    const auth = await getAdminAuth();
    await auth.updateUser(body.uid, { password: generatedPassword });

    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "USER_PASSWORD_RESET",
      performedBy: session.uid,
      performedByName: actorName,
      targetId: body.uid,
      details: { targetRole: target.role, targetName: target.name },
      timestamp: new Date(),
    });

    return NextResponse.json({ ok: true, generatedPassword });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[webmaster/reset-password POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
