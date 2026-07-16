export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET() {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE", "ACCOUNTS", "PANEL_MEMBER");

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("departments")
      .orderBy("name")
      .get();

    const departments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ departments });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/departments GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");

    const body = (await request.json()) as {
      name: string;
      code: string;
      hodUid?: string;
      hodName?: string;
    };

    const { name, code, hodUid, hodName } = body;

    if (!name || !code) {
      return NextResponse.json({ error: "Name and code are required" }, { status: 400 });
    }

    const collegeId = session.collegeId;
    const db = getAdminDb();
    const now = new Date();

    const ref = await db
      .collection("colleges")
      .doc(collegeId)
      .collection("departments")
      .add({
        collegeId,
        name: name.trim(),
        code: code.toUpperCase().trim(),
        hodUid: hodUid ?? "",
        hodName: hodName ?? "",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

    await db
      .collection("colleges")
      .doc(collegeId)
      .collection("auditLogs")
      .add({
        collegeId,
        action: "DEPARTMENT_CREATED" as string,
        performedBy: session.uid,
        performedByName: "Principal",
        targetId: ref.id,
        details: { name, code },
        timestamp: now,
      });

    return NextResponse.json({ deptId: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/departments POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const deptId = searchParams.get("deptId");
    if (!deptId) {
      return NextResponse.json({ error: "deptId required" }, { status: 400 });
    }

    const db = getAdminDb();
    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("departments")
      .doc(deptId)
      .delete();

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/departments DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");

    const body = (await request.json()) as {
      deptId: string;
      hodUid?: string;
      hodName?: string;
      isActive?: boolean;
      name?: string;
      code?: string;
    };

    const { deptId, ...updates } = body;
    if (!deptId) {
      return NextResponse.json({ error: "deptId required" }, { status: 400 });
    }

    const db = getAdminDb();
    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("departments")
      .doc(deptId)
      .update({ ...updates, updatedAt: new Date() });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/departments PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
