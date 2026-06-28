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

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "HOD",
      "PRINCIPAL",
      "SUPER_ADMIN",
      "PANEL_MEMBER",
      "VICE_PRINCIPAL"
    );
    const { searchParams } = new URL(request.url);
    const myLeave = searchParams.get("myLeave") === "true";
    const dept = searchParams.get("dept") === "true";
    const statusFilter = searchParams.get("status");

    const db = getAdminDb();
    const currentYear = new Date().getFullYear();

    // Fetch balance for the session user
    const balanceSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("leaveBalances")
      .doc(`${session.uid}_${currentYear}`)
      .get();
    const balance = balanceSnap.exists ? { id: balanceSnap.id, ...balanceSnap.data() } : null;

    // Fetch all leave applications (no orderBy to avoid composite index)
    const collRef = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("leaveApplications");

    const snap = await collRef.get();
    type LeaveDoc = Record<string, unknown> & { id: string };
    let leaves: LeaveDoc[] = snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeaveDoc));

    if (myLeave) {
      // Own leaves
      leaves = leaves.filter((l) => l.applicantUid === session.uid);
    } else if (dept && session.role === "HOD") {
      // HOD viewing dept leaves for approval — requires HOD's department
      const hodDoc = await getUserDoc(db, session.collegeId, session.uid);
      const hodDept = hodDoc?.department ?? "";
      leaves = leaves.filter(
        (l) => l.department === hodDept && l.status === "PENDING"
      );
    } else {
      // Default: HOD sees their dept, PRINCIPAL/SUPER_ADMIN sees all
      if (session.role === "HOD") {
        const hodDoc = await getUserDoc(db, session.collegeId, session.uid);
        const hodDept = hodDoc?.department ?? "";
        leaves = leaves.filter((l) => l.department === hodDept);
      }
      // PANEL_MEMBER and VICE_PRINCIPAL fall through to see all (adjust if needed)
    }

    if (statusFilter) {
      leaves = leaves.filter((l) => l.status === statusFilter);
    }

    // Sort by createdAt desc in-memory (avoids composite index requirement)
    leaves.sort((a, b) => {
      const aTime =
        a.createdAt && typeof (a.createdAt as { toMillis?: () => number }).toMillis === "function"
          ? (a.createdAt as { toMillis: () => number }).toMillis()
          : a.createdAt
          ? new Date(a.createdAt as string).getTime()
          : 0;
      const bTime =
        b.createdAt && typeof (b.createdAt as { toMillis?: () => number }).toMillis === "function"
          ? (b.createdAt as { toMillis: () => number }).toMillis()
          : b.createdAt
          ? new Date(b.createdAt as string).getTime()
          : 0;
      return bTime - aTime;
    });

    return NextResponse.json({ leaves, balance });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/leave-applications GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PANEL_MEMBER", "VICE_PRINCIPAL");
    const body = (await request.json()) as {
      leaveType: string;
      fromDate: string;
      toDate: string;
      reason: string;
      isHalfDay?: boolean;
      halfDaySession?: "MORNING" | "AFTERNOON";
      substituteArrangement?: string;
    };

    const { leaveType, fromDate, toDate, reason, isHalfDay, halfDaySession, substituteArrangement } =
      body;

    if (!leaveType || !fromDate || !toDate || !reason) {
      return NextResponse.json(
        { error: "leaveType, fromDate, toDate, reason are required" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const applicantDoc = await getUserDoc(db, session.collegeId, session.uid);
    const applicantName = applicantDoc?.name ?? "Unknown";
    const department = applicantDoc?.department ?? "";

    const from = new Date(fromDate);
    const to = new Date(toDate);
    const totalDays =
      isHalfDay ? 0.5 : Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;

    const now = new Date();

    const ref = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("leaveApplications")
      .add({
        collegeId: session.collegeId,
        applicantUid: session.uid,
        applicantName,
        department,
        leaveType,
        fromDate: from,
        toDate: to,
        totalDays,
        isHalfDay: isHalfDay ?? false,
        ...(halfDaySession !== undefined && { halfDaySession }),
        reason,
        ...(substituteArrangement !== undefined && { substituteArrangement }),
        status: "PENDING",
        createdAt: now,
        updatedAt: now,
      });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/leave-applications POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
