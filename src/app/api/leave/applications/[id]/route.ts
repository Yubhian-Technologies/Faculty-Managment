export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { canAccessLeaveProfile } from "@/lib/leave/access";
import { resolveUserDepartment } from "@/lib/budget/departmentScope";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { computeEffectiveCategory } from "@/lib/leave/categoryEngine";
import { REQUESTS_COL, PROFILES_COL, commitApproval, releasePending, loadBalances, computeEntitlement } from "@/lib/leave/balanceEngine";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";
import { notify } from "@/lib/notify";
import { emitWorkflowNotification, resolveWorkflowNotifications } from "@/lib/notifications/workflowNotifications";
import type { LeaveRequest, LeaveActionRecord, LeaveTypeFull, EmployeeLeaveProfile } from "@/types/leave";

// Balance is never reserved at submission (see applications/route.ts), and
// insufficient balance never blocks approval either - days beyond what's
// remaining are accepted and split off as Loss of Pay instead. If no balance
// doc exists yet (e.g. first request of this type, or balances were reset),
// entitled falls back to the profile's computed default - NOT zero, which
// was an earlier bug: a missing doc isn't the same as zero balance.
async function splitLeaveDays(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  uid: string,
  lt: LeaveTypeFull,
  year: number,
  days: number
): Promise<{ withinBalance: number; lopDays: number }> {
  const balances = await loadBalances(db, collegeId, uid, year);
  const bal = balances.find((b) => b.leaveTypeCode === lt.code);
  let entitled = bal?.entitled;
  if (entitled === undefined) {
    const [profileSnap, settings] = await Promise.all([
      PROFILES_COL(collegeId, db).doc(uid).get(),
      loadCollegeSettings(db, collegeId),
    ]);
    const profile = { id: profileSnap.id, ...profileSnap.data() } as EmployeeLeaveProfile;
    entitled = computeEntitlement(lt, computeEffectiveCategory(profile, settings.newJoiningYears));
  }
  const remaining = Math.max(0, entitled - (bal?.used ?? 0));
  const withinBalance = Math.min(days, remaining);
  return { withinBalance, lopDays: days - withinBalance };
}

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
      if (req.status !== "PENDING_HOD" && req.status !== "PENDING_PRINCIPAL") {
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
    // balance-tracked). Either way this is the final decision.
    if (req.status === "PENDING_PRINCIPAL") {
      if (session.role !== "PRINCIPAL" && session.role !== "VICE_PRINCIPAL") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const actionRecord: LeaveActionRecord = {
        action: body.action === "APPROVE" ? "APPROVED" : "REJECTED",
        by: session.uid, byName: session.email || "Principal", at: now as unknown as LeaveActionRecord["at"],
        ...(body.remarks ? { remarks: body.remarks } : {}),
      };

      let lopDays = 0;
      if (body.action === "REJECT") {
        if (req.leaveTypeCode) {
          const lt = LEAVE_TYPE_SEED.find((t) => t.code === req.leaveTypeCode);
          if (lt && !lt.rules.unlimited) {
            await releasePending(db, session.collegeId, req.uid, req.leaveTypeCode, year, req.totalDays);
          }
        }
        await ref.update({ status: "REJECTED", principalAction: actionRecord, updatedAt: now });
      } else {
        // Insufficient balance never blocks this - the excess becomes Loss of Pay.
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
        await ref.update({ status: "APPROVED", principalAction: actionRecord, lopDays, updatedAt: now });
      }

      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId,
        action: body.action === "APPROVE" ? "LEAVE_PRINCIPAL_APPROVED" : "LEAVE_REJECTED",
        performedBy: session.uid, performedByName: session.email || "Principal", targetId: id, details: { lopDays }, timestamp: now,
      });

      await resolveWorkflowNotifications({ db, collegeId: session.collegeId, entityType: "leaveRequest", entityId: id });
      await notify(
        db, session.collegeId, req.uid,
        body.action === "APPROVE" ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
        body.action === "APPROVE" ? "Leave Request Approved" : "Leave Request Rejected",
        `Your leave request for ${req.totalDays} day(s) was ${body.action === "APPROVE" ? "approved" : "rejected"} by the Principal` +
          (body.action === "APPROVE" && lopDays > 0 ? ` — ${lopDays} day(s) exceed your balance and will be treated as Loss of Pay.` : "."),
        "/panel/leave"
      );
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
