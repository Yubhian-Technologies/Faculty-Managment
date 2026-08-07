export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { canAccessLeaveProfile } from "@/lib/leave/access";
import { resolveUserDepartment } from "@/lib/budget/departmentScope";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { computeEffectiveCategory } from "@/lib/leave/categoryEngine";
import { REQUESTS_COL, PROFILES_COL, loadBalances, reservePending, commitApproval, releasePending, computeEntitlement } from "@/lib/leave/balanceEngine";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";
import type { LeaveRequest, LeaveActionRecord, LeaveTypeCode, EmployeeLeaveProfile } from "@/types/leave";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF"
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
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF"
    );
    const body = (await request.json()) as {
      action?: "APPROVE" | "REJECT" | "CANCEL";
      remarks?: string;
      assignedLeaveTypeCode?: LeaveTypeCode;
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
        remarks: body.remarks,
      };

      if (body.action === "REJECT") {
        if (req.leaveTypeCode) {
          const lt = LEAVE_TYPE_SEED.find((t) => t.code === req.leaveTypeCode);
          if (lt && !lt.rules.unlimited) {
            await releasePending(db, session.collegeId, req.uid, req.leaveTypeCode, year, req.totalDays);
          }
        }
        await ref.update({ status: "REJECTED", hodAction: actionRecord, updatedAt: now });
      } else {
        let leaveTypeCode = req.leaveTypeCode;
        if (req.isOtherRequest && !leaveTypeCode) {
          if (!body.assignedLeaveTypeCode) {
            return NextResponse.json({ error: "assignedLeaveTypeCode is required to approve an Other request" }, { status: 400 });
          }
          const profileSnap = await PROFILES_COL(session.collegeId, db).doc(req.uid).get();
          const profile = { id: profileSnap.id, ...profileSnap.data() } as EmployeeLeaveProfile;
          const settings = await loadCollegeSettings(db, session.collegeId);
          const effectiveCategory = computeEffectiveCategory(profile, settings.newJoiningYears);

          const lt = LEAVE_TYPE_SEED.find((t) => t.code === body.assignedLeaveTypeCode && t.isActive);
          if (!lt || !lt.rules.eligibleCategories.includes(effectiveCategory)) {
            return NextResponse.json({ error: "That leave type isn't available for this employee's leave profile" }, { status: 400 });
          }
          if (!lt.rules.unlimited) {
            const balances = await loadBalances(db, session.collegeId, req.uid, year);
            const bal = balances.find((b) => b.leaveTypeCode === lt.code);
            const entitled = bal?.entitled ?? computeEntitlement(lt, effectiveCategory);
            const remaining = entitled - (bal?.used ?? 0) - (bal?.pending ?? 0);
            if (req.totalDays > remaining) {
              return NextResponse.json({ error: `Insufficient ${lt.label} balance (${remaining} day(s) remaining)` }, { status: 400 });
            }
            await reservePending(db, session.collegeId, req.uid, lt.code, year, req.totalDays);
          }
          leaveTypeCode = lt.code;
          actionRecord.assignedLeaveTypeCode = lt.code;
        }
        await ref.update({ status: "PENDING_PRINCIPAL", leaveTypeCode, hodAction: actionRecord, updatedAt: now });
      }

      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId,
        action: body.action === "APPROVE" ? "LEAVE_HOD_APPROVED" : "LEAVE_REJECTED",
        performedBy: session.uid, performedByName: session.email || "HOD", targetId: id, details: {}, timestamp: now,
      });
      return NextResponse.json({ ok: true });
    }

    // ─── Principal / Vice Principal stage (final) ────────────────────────────
    if (req.status === "PENDING_PRINCIPAL") {
      if (session.role !== "PRINCIPAL" && session.role !== "VICE_PRINCIPAL") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const actionRecord: LeaveActionRecord = {
        action: body.action === "APPROVE" ? "APPROVED" : "REJECTED",
        by: session.uid, byName: session.email || "Principal", at: now as unknown as LeaveActionRecord["at"],
        remarks: body.remarks,
      };

      if (body.action === "REJECT") {
        if (req.leaveTypeCode) {
          const lt = LEAVE_TYPE_SEED.find((t) => t.code === req.leaveTypeCode);
          if (lt && !lt.rules.unlimited) {
            await releasePending(db, session.collegeId, req.uid, req.leaveTypeCode, year, req.totalDays);
          }
        }
        await ref.update({ status: "REJECTED", principalAction: actionRecord, updatedAt: now });
      } else {
        if (!req.leaveTypeCode) {
          return NextResponse.json({ error: "No leave type assigned to this request yet" }, { status: 400 });
        }
        const lt = LEAVE_TYPE_SEED.find((t) => t.code === req.leaveTypeCode);
        if (lt && !lt.rules.unlimited) {
          await commitApproval(db, session.collegeId, req.uid, req.leaveTypeCode, year, req.totalDays);
        }
        await ref.update({ status: "APPROVED", principalAction: actionRecord, updatedAt: now });
      }

      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId,
        action: body.action === "APPROVE" ? "LEAVE_PRINCIPAL_APPROVED" : "LEAVE_REJECTED",
        performedBy: session.uid, performedByName: session.email || "Principal", targetId: id, details: {}, timestamp: now,
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
