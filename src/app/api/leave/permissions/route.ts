export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { resolveEmployeeIdentity } from "@/lib/leave/identity";
import { resolveApproverStage, approverStageToStatus } from "@/lib/leave/approvalRouting";
import { notifyPermissionRequested } from "@/lib/leave/permissionNotify";
import { PENDING_PERMISSION_STATUSES, type PermissionRequest, type PermissionRequestStatus } from "@/types/permission";

const COL = "permissionRequests";

// Same roles the leave routes accept - anyone who can ask for leave can ask
// for a late-attendance permission.
const REQUESTER_ROLES = [
  "PANEL_MEMBER", "HOD", "VICE_PRINCIPAL", "PRINCIPAL",
  "COLLEGE_OFFICE", "COLLEGE_STAFF", "ACCOUNTS", "FINANCE", "ACADEMICS", "IQAC_COORDINATOR",
  "T_AND_P", "R_AND_D", "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT",
] as const;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * GET ?scope=mine        - the caller's own permissions, newest first
 *     ?scope=approvals   - the ones waiting on the caller to decide
 *
 * Sorted in memory rather than with .orderBy() next to a .where() on another
 * field, which would need a composite index - the same convention the leave
 * routes follow.
 */
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...REQUESTER_ROLES);
    const db = getAdminDb();
    const col = db.collection("colleges").doc(session.collegeId).collection(COL);
    const scope = new URL(request.url).searchParams.get("scope") ?? "mine";

    let rows: (PermissionRequest & { id: string })[] = [];

    if (scope === "approvals") {
      const snap = await col.where("status", "in", PENDING_PERMISSION_STATUSES).get();
      rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PermissionRequest & { id: string });
      // Never your own - approving your own permission is exactly what the
      // routing exists to prevent.
      rows = rows.filter((r) => r.uid !== session.uid);
      if (session.role === "HOD") {
        // An HOD decides their own department's, and only the ones actually
        // routed to the HOD tier.
        const mine = await resolveEmployeeIdentity(db, session.collegeId, session.uid);
        rows = rows.filter((r) => r.status === "PENDING_HOD" && !!r.department && r.department === mine?.department);
      } else if (session.role === "PRINCIPAL") {
        // Principal sees both - senior override on VP-routed requests too.
        rows = rows.filter((r) => r.status === "PENDING_PRINCIPAL" || r.status === "PENDING_VICE_PRINCIPAL");
      } else if (session.role === "VICE_PRINCIPAL") {
        rows = rows.filter((r) => r.status === "PENDING_VICE_PRINCIPAL");
      } else {
        rows = [];
      }
    } else {
      const snap = await col.where("uid", "==", session.uid).get();
      rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PermissionRequest & { id: string });
    }

    rows.sort((a, b) => {
      const ad = `${a.date}T${a.fromTime}`;
      const bd = `${b.date}T${b.fromTime}`;
      return bd.localeCompare(ad);
    });

    return NextResponse.json({ permissions: rows });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/permissions GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...REQUESTER_ROLES);
    const body = (await request.json()) as Partial<{
      date: string; fromTime: string; toTime: string; reason: string;
    }>;

    const date = (body.date ?? "").trim();
    const fromTime = (body.fromTime ?? "").trim();
    const toTime = (body.toTime ?? "").trim();
    const reason = (body.reason ?? "").trim();

    if (!DATE.test(date)) return NextResponse.json({ error: "A valid date is required" }, { status: 400 });
    if (!TIME.test(fromTime) || !TIME.test(toTime)) {
      return NextResponse.json({ error: "From and To time are required (24-hour HH:MM)" }, { status: 400 });
    }
    if (minutesOf(toTime) <= minutesOf(fromTime)) {
      return NextResponse.json({ error: "To time must be after From time" }, { status: 400 });
    }
    if (!reason) return NextResponse.json({ error: "A reason is required" }, { status: 400 });

    const db = getAdminDb();
    const identity = await resolveEmployeeIdentity(db, session.collegeId, session.uid);
    if (!identity) {
      return NextResponse.json({ error: "No employee record found for your account" }, { status: 400 });
    }

    // The college's own routing decides the tier, exactly as it does for
    // leave - so a faculty member reaches their HOD and an HOD reaches the
    // Principal, and a college that has re-pointed either one is honoured
    // here too rather than being second-guessed.
    const settings = await loadCollegeSettings(db, session.collegeId);
    const stage = resolveApproverStage(settings.leaveApprovalRouting, session.role, !!identity.department);
    const status: PermissionRequestStatus = approverStageToStatus(stage);

    const now = new Date();
    const doc = {
      collegeId: session.collegeId,
      uid: session.uid,
      employeeName: identity.name,
      department: identity.department ?? "",
      role: session.role,
      date,
      fromTime,
      toTime,
      minutes: minutesOf(toTime) - minutesOf(fromTime),
      reason,
      status,
      approverStage: stage,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await db.collection("colleges").doc(session.collegeId).collection(COL).add(doc);

    try {
      await notifyPermissionRequested(db, session.collegeId, { id: ref.id, ...doc });
    } catch (notifyErr) {
      // The request itself is saved; a failed notification must not lose it.
      console.error("[leave/permissions POST] notify failed:", notifyErr);
    }

    return NextResponse.json({ id: ref.id, status }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/permissions POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
