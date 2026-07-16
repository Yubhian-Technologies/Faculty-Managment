export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Firestore } from "firebase-admin/firestore";

async function getUserDoc(
  db: Firestore,
  collegeId: string,
  uid: string
): Promise<{ name?: string; department?: string } | null> {
  if (!collegeId || !uid) return null;
  try {
    const snap = await db
      .collection("colleges")
      .doc(collegeId)
      .collection("users")
      .doc(uid)
      .get();
    return (snap.data() as { name?: string; department?: string } | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as {
      action: "APPROVED" | "REJECTED";
      remarks?: string;
    };

    const { action, remarks } = body;
    if (!action || (action !== "APPROVED" && action !== "REJECTED")) {
      return NextResponse.json(
        { error: 'action must be "APPROVED" or "REJECTED"' },
        { status: 400 }
      );
    }

    const db = getAdminDb();

    // Fetch the leave doc and verify it belongs to the same college
    const leaveRef = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("leaveApplications")
      .doc(id);

    const leaveSnap = await leaveRef.get();
    if (!leaveSnap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const leave = leaveSnap.data() as {
      collegeId: string;
      applicantUid: string;
      department: string;
    };

    // Verify the leave belongs to this college
    if (leave.collegeId !== session.collegeId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const actorDoc = await getUserDoc(db, session.collegeId, session.uid);
    const byName = actorDoc?.name ?? "Unknown";
    const now = new Date();

    if (session.role === "HOD") {
      // HOD cannot act on their own leave
      if (leave.applicantUid === session.uid) {
        return NextResponse.json(
          { error: "HOD cannot approve or reject their own leave" },
          { status: 403 }
        );
      }

      // HOD can only act on leaves from their own department
      const hodDoc = await getUserDoc(db, session.collegeId, session.uid);
      const hodDept = hodDoc?.department ?? "";
      if (leave.department !== hodDept) {
        return NextResponse.json(
          { error: "HOD can only act on leaves within their department" },
          { status: 403 }
        );
      }

      const newStatus = action === "APPROVED" ? "HOD_APPROVED" : "REJECTED";
      await leaveRef.update({
        hodAction: {
          action,
          by: session.uid,
          byName,
          at: now,
          ...(remarks !== undefined && { remarks }),
        },
        status: newStatus,
        updatedAt: now,
      });
    } else {
      // PRINCIPAL or SUPER_ADMIN can act on any leave
      const newStatus = action === "APPROVED" ? "PRINCIPAL_APPROVED" : "REJECTED";
      await leaveRef.update({
        principalAction: {
          action,
          by: session.uid,
          byName,
          at: now,
          ...(remarks !== undefined && { remarks }),
        },
        status: newStatus,
        updatedAt: now,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/leave-applications/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
