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

    // Keep the HOD's own profile department in sync — faculty-requirement
    // and other HOD-scoped routes resolve department from their user doc,
    // not from the department's hodUid pointer.
    if (hodUid) {
      await db.collection("colleges").doc(collegeId).collection("users").doc(hodUid)
        .update({ department: name.trim(), updatedAt: now })
        .catch(() => {});
    }

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
      assignedYears?: number[];
    };

    const { deptId, ...updates } = body;
    if (!deptId) {
      return NextResponse.json({ error: "deptId required" }, { status: 400 });
    }

    const db = getAdminDb();

    // Assigned years must be a subset of the years this college has actually
    // opened (Location Admin's Academic Years toggle) — mirrors the same
    // check already done for Section creation in college/sections/route.ts.
    if (updates.assignedYears) {
      const academicYearsSnap = await db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("academicYears")
        .get();
      const openYears = new Set(
        academicYearsSnap.docs
          .map((d) => d.data() as { yearNumber: number; isActive: boolean })
          .filter((y) => y.isActive)
          .map((y) => y.yearNumber)
      );
      const invalid = updates.assignedYears.filter((y) => !openYears.has(Number(y)));
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: `Year(s) ${invalid.join(", ")} are not open for this college` },
          { status: 400 }
        );
      }
    }

    const deptRef = db.collection("colleges").doc(session.collegeId).collection("departments").doc(deptId);
    const now = new Date();

    // Keep the outgoing/incoming HOD's own profile department in sync with
    // the assignment — faculty-requirement and other HOD-scoped routes
    // resolve department from their user doc, not from hodUid.
    if (updates.hodUid !== undefined) {
      const deptSnap = await deptRef.get();
      const prev = deptSnap.data() as { hodUid?: string; name?: string } | undefined;
      const finalName = updates.name?.trim() ?? prev?.name ?? "";
      const usersColl = db.collection("colleges").doc(session.collegeId).collection("users");

      if (prev?.hodUid && prev.hodUid !== updates.hodUid) {
        await usersColl.doc(prev.hodUid).update({ department: "", updatedAt: now }).catch(() => {});
      }
      if (updates.hodUid) {
        await usersColl.doc(updates.hodUid).update({ department: finalName, updatedAt: now }).catch(() => {});
      }
    }

    await deptRef.update({ ...updates, updatedAt: now });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/departments PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
