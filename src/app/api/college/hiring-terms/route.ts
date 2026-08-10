export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get("includeInactive") === "true";

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("hiringTermsTemplates")
      .orderBy("createdAt", "desc")
      .get();

    let templates = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!includeInactive) {
      templates = templates.filter((t) => (t as { isActive?: boolean }).isActive !== false);
    }

    return NextResponse.json({ templates });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[hiring-terms GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as { text?: string };
    const text = body.text?.trim();
    if (!text) {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }

    const db = getAdminDb();
    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    const now = new Date();

    const ref = await db.collection("colleges").doc(session.collegeId).collection("hiringTermsTemplates").add({
      collegeId: session.collegeId,
      text,
      isActive: true,
      createdBy: session.uid,
      createdByName: actorName,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[hiring-terms POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
