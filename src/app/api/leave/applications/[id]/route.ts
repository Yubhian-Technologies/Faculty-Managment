export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { canAccessLeaveProfile } from "@/lib/leave/access";
import { resolveUserDepartment } from "@/lib/budget/departmentScope";
import { REQUESTS_COL, commitApproval, releasePending, splitLeaveDays } from "@/lib/leave/balanceEngine";
import { decideFinalStageLeave } from "@/lib/leave/decideFinalStage";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";
import { notify } from "@/lib/notify";
import { emitWorkflowNotification } from "@/lib/notifications/workflowNotifications";
import type { LeaveRequest, LeaveActionRecord } from "@/types/leave";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D"
    );
    const db = getAdminDb();

    const snap = await REQUESTS_COL(session.collegeId, db).doc(id).get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const req = { id: snap.id, ...snap.data() } as LeaveRequest;

    if (!(await canAccessLeaveProfile(db, session.collegeId, session.role, session.uid, req.uid))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ request: req });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/applications/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D"
    );
    const body = (await request.json()) as {
      action?: "APPROVE" | "REJECT" | "CANCEL";
      remarks?: string;
      isPaidLeave?: boolean;
    };
    if (!body.action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = REQUESTS_COL(session.collegeId, db).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const req = { id: snap.id, ...snap.data() } as LeaveRequest;

    const now = new Date();
    const year = (req.fromDate as unknown as { toDate(): Date }).toDate().getFullYear();

    // ─── Cancel (requester only, while still pending) ───────────────────────
    if (body.action === "CANCEL") {
      if (req.uid !== session.uid) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (req.status !== "PENDING_HOD" && req.status !== "PENDING_PRINCIPAL" && req.status !== "PENDING_MANAGEMENT") {
        return NextResponse.json({ error: "Only pending requests can be cancelled" }, { status: 400 });
      }
      if (req.leaveTypeCode) {
        const lt = LEAVE_TYPE_SEED.find((t) => t.code === req.leaveTypeCode);
        if (lt && !lt.rules.unlimited) {
          await releasePending(db, session.collegeId, req.uid, req.leaveTypeCode, year, req.totalDays);
        }
      }
      await ref.update({ status: "CANCELLED", updatedAt: now });
      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId, action: "LEAVE_CANCELLED", performedBy: session.uid,
        performedByName: req.employeeName, targetId: id, details: {}, timestamp: now,
      });
      return NextResponse.json({ ok: true });
    }

    // ─── HOD stage ────────────────────────────────────────────────────────────
    // Standard types (CL/SL/SCL/EL/OD): the HOD's decision is final - APPROVE
    // commits the balance and closes the request out; REJECT releases it.
    // "Other" requests: the HOD can REJECT outright, or tag isPaidLeave and
    // forward to the Principal for the real decision (Other is never
    // balance-tracked, so nothing is reserved/committed for it here).
    if (req.status === "PENDING_HOD") {
      if (session.role !== "HOD") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const hodDept = await resolveUserDepartment(db, session.collegeId, session.uid);
      if (!hodDept || req.department !== hodDept) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const actionRecord: LeaveActionRecord = {
        action: body.action === "APPROVE" ? "APPROVED" : "REJECTED",
        by: session.uid, byName: session.email || "HOD", at: now as unknown as LeaveActionRecord["at"],
        ...(body.remarks ? { remarks: body.remarks } : {}),
      };

      if (body.action === "REJECT") {
        if (req.leaveTypeCode) {
          const lt = LEAVE_TYPE_SEED.find((t) => t.code === req.leaveTypeCode);
          if (lt && !lt.rules.unlimited) {
            await releasePending(db, session.collegeId, req.uid, req.leaveTypeCode, year, req.totalDays);
          }
        }
        await ref.update({ status: "REJECTED", hodAction: actionRecord, updatedAt: now });
        await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
          collegeId: session.collegeId, action: "LEAVE_REJECTED", performedBy: session.uid,
          performedByName: session.email || "HOD", targetId: id, details: {}, timestamp: now,
        });
        await notify(db, session.collegeId, req.uid, "LEAVE_REJECTED", "Leave Request Rejected",
          `Your leave request for ${req.totalDays} day(s) was rejected by your HOD.`, "/panel/leave");
        return NextResponse.json({ ok: true });
      }

      // APPROVE
      if (req.isOtherRequest) {
        if (typeof body.isPaidLeave !== "boolean") {
          return NextResponse.json({ error: "isPaidLeave is required to forward an Other request" }, { status: 400 });
        }
        actionRecord.isPaidLeave = body.isPaidLeave;
        await ref.update({ status: "PENDING_PRINCIPAL", isPaidLeave: body.isPaidLeave, hodAction: actionRecord, updatedAt: now });
        await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
          collegeId: session.collegeId, action: "LEAVE_HOD_FORWARDED", performedBy: session.uid,
          performedByName: session.email || "HOD", targetId: id, details: { isPaidLeave: body.isPaidLeave }, timestamp: now,
        });

        const principalsSnap = await db
          .collection("colleges").doc(session.collegeId)
          .collection("users").where("role", "in", ["PRINCIPAL", "VICE_PRINCIPAL"]).get();
        for (const p of principalsSnap.docs) {
          await emitWorkflowNotification({
            db, collegeId: session.collegeId, toUid: p.id,
            type: "LEAVE_PENDING_APPROVAL",
            title: "Leave Request Awaiting Approval",
            message: `${req.employeeName}'s "Other" leave request (${body.isPaidLeave ? "paid" : "unpaid"}) was forwarded by their HOD and needs your decision.`,
            link: "/principal/leave-approvals",
            entityType: "leaveRequest", entityId: id,
            dedupeKey: `leave-request-review:${id}:${p.id}`,
          });
        }
        return NextResponse.json({ ok: true });
      }

      // Standard type - HOD approval is final. Insufficient balance never
      // blocks this - the excess becomes Loss of Pay instead.
      let lopDays = 0;
      if (req.leaveTypeCode) {
        const lt = LEAVE_TYPE_SEED.find((t) => t.code === req.leaveTypeCode);
        if (lt && !lt.rules.unlimited) {
          const split = await splitLeaveDays(db, session.collegeId, req.uid, lt, year, req.totalDays);
          lopDays = split.lopDays;
          if (split.withinBalance > 0) {
            await commitApproval(db, session.collegeId, req.uid, req.leaveTypeCode, year, split.withinBalance);
          }
        }
      }
      await ref.update({ status: "APPROVED", hodAction: actionRecord, lopDays, updatedAt: now });
      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId, action: "LEAVE_HOD_APPROVED", performedBy: session.uid,
        performedByName: session.email || "HOD", targetId: id, details: { lopDays }, timestamp: now,
      });
      await notify(db, session.collegeId, req.uid, "LEAVE_APPROVED", "Leave Request Approved",
        `Your leave request for ${req.totalDays} day(s) was approved by your HOD` +
          (lopDays > 0 ? ` — ${lopDays} day(s) exceed your balance and will be treated as Loss of Pay.` : "."),
        "/panel/leave");
      return NextResponse.json({ ok: true });
    }

    // ─── Principal / Vice Principal stage (final) ────────────────────────────
    // Reached either by a non-PANEL_MEMBER's own leave request (any type,
    // unchanged from before - commits/releases its balance as always) or by
    // an HOD-forwarded "Other" request (isPaidLeave already set, never
    // balance-tracked). Either way this is the final decision. A PRINCIPAL's
    // own leave never lands here at all - it starts at PENDING_MANAGEMENT
    // instead (see applications/route.ts POST) and is decided via
    // /api/management/leave-approvals, not this route.
    if (req.status === "PENDING_PRINCIPAL") {
      if (session.role !== "PRINCIPAL" && session.role !== "VICE_PRINCIPAL") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      // A Vice Principal's own leave request must be decided by the
      // Principal, not themselves - the approvals queue (GET .../
      // applications?scope=approvals) already hides it from their own list,
      // this is the server-side backstop for that.
      if (session.role === "VICE_PRINCIPAL" && req.uid === session.uid) {
        return NextResponse.json(
          { error: "Your own leave request must be approved by the Principal" },
          { status: 403 },
        );
      }

      if (body.action !== "APPROVE" && body.action !== "REJECT") {
        return NextResponse.json({ error: "action must be APPROVE or REJECT" }, { status: 400 });
      }
      await decideFinalStageLeave({
        db, collegeId: session.collegeId, id, req,
        action: body.action, remarks: body.remarks,
        decidedByUid: session.uid, decidedByEmail: session.email,
        decider: "PRINCIPAL",
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "This request is no longer pending" }, { status: 400 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/applications/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
