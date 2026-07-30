export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";

// Fields a Principal/VP must never set about themselves via self-service edit —
// salary/CTC belongs to the Accounts/Finance payroll domain, not a self-editable profile.
const FINANCIAL_ACADEMIC_KEYS = ["presentSalary", "grossAnnualCTC", "incrementsAwarded", "fundingConsultancyRevenue"];

export async function PATCH(request: Request) {
  try {
    // Self-service only — the target uid always comes from the verified session,
    // never from the request body, mirroring me/photo/route.ts.
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL");

    const body = (await request.json()) as Partial<{
      name: string;
      email: string;
      collegeEmail: string;
      employeeId: string;
      phone: string;
      academicProfile: Record<string, unknown>;
      profilePhotoUrl: string;
    }> & PersonalDetailsInput;

    if (
      body.profilePhotoUrl !== undefined &&
      body.profilePhotoUrl !== "" &&
      (!body.profilePhotoUrl.startsWith("https://firebasestorage.googleapis.com/") ||
        !body.profilePhotoUrl.includes(encodeURIComponent(`profile-photos/${session.uid}_`)))
    ) {
      return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
    }

    const db = getAdminDb();
    const userRef = db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now, ...buildPersonalDetailsUpdate(body) };

    if (body.name !== undefined && body.name.trim()) updates.name = body.name.trim();
    if (body.email !== undefined && body.email.trim()) updates.email = body.email.trim();
    if (body.collegeEmail !== undefined) updates.collegeEmail = body.collegeEmail;
    if (body.employeeId !== undefined) updates.employeeId = body.employeeId;
    if (body.phone !== undefined) updates.phone = body.phone;
    if (body.academicProfile !== undefined) {
      const academicProfile = { ...body.academicProfile };
      for (const key of FINANCIAL_ACADEMIC_KEYS) delete academicProfile[key];
      updates.academicProfile = academicProfile;
    }
    if (body.profilePhotoUrl !== undefined) updates.profilePhotoUrl = body.profilePhotoUrl;

    await userRef.update(updates);

    if ((body.name !== undefined && body.name.trim()) || body.profilePhotoUrl !== undefined) {
      await db.collection("systemUsers").doc(session.uid).set(
        {
          ...(body.name !== undefined && body.name.trim() ? { name: body.name.trim() } : {}),
          ...(body.profilePhotoUrl !== undefined ? { profilePhotoUrl: body.profilePhotoUrl } : {}),
        },
        { merge: true }
      );
    }

    const actorName = (userSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "USER_UPDATED",
      performedBy: session.uid,
      performedByName: actorName,
      targetId: session.uid,
      details: { role: session.role, self: true },
      timestamp: now,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/users/me PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
