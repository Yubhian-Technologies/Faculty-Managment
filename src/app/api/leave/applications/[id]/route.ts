export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { LeaveRequestV2, LeaveTypeCodeV2, LeaveTypeFull, ApprovalChainV2 } from "@/types/leave";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";
import {
  REQUESTS_COL,
  LEAVE_COL,
  balanceDocId,
} from "@/lib/leave/balanceEngine";

const LT_SHORT: Partial<Record<LeaveTypeCodeV2, string>> = {
  CL: "Casual", SCL: "Special Casual", EL: "Earned", ML: "Sick",
  MAT: "Maternity", FPL: "Family Planning", COMP: "Compensatory",
  LND: "Leave Not Due", QUAR: "Quarantine", EOL: "Extraordinary",
  SAB: "Sabbatical", VAC: "Vacation",
};

function labelFor(code?: LeaveTypeCodeV2) {
  if (!code) return "Other";
  return LT_SHORT[code] ?? code;
}

// Looks up the leave type's approval chain - "standard" types are fully
// decided by the HOD; "management"/"medical_officer" types still require
// Principal/VP ratification after HOD sign-off.
async function resolveApprovalChain(
  db: ReturnType<typeof getAdminDb>,
  code: LeaveTypeCodeV2
): Promise<ApprovalChainV2> {
  const snap = await db.collection("leaveTypes").doc(code).get();
  const leaveType = snap.exists
    ? (snap.data() as LeaveTypeFull)
    : LEAVE_TYPE_SEED.find((l) => l.code === code);
  return leaveType?.rules.approvalChain ?? "standard";
}

async function notify(
  db: ReturnType<typeof getAdminDb>,
  collegeId: string,
  toUid: string,
  type: string,
  title: string,
  message: string,
  link?: string
) {
  try {
    await db.collection("colleges").doc(collegeId).collection("notifications").add({
      collegeId, toUid, type, title, message,
      read: false, link: link ?? null, createdAt: new Date(),
    });
  } catch { /* non-fatal */ }
}

// ─── GET - fetch a single leave request ──────────────────────────────────────

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "SUPER_ADMIN"
    );

    const db = getAdminDb();
    const snap = await REQUESTS_COL(session.collegeId, db).doc(id).get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const req = { id: snap.id, ...snap.data() } as LeaveRequestV2;

    if (session.role === "PANEL_MEMBER" && req.employeeId !== session.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const stepsSnap = await db
      .collection("colleges").doc(session.collegeId)
      .collection("leaveApprovalSteps")
      .where("applicationId", "==", id)
      .get();
    type StepDoc = { id: string; sequence?: number };
    const steps = (stepsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() })) as StepDoc[])
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

    return NextResponse.json({ request: req, steps });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/applications/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ─── PATCH - cancel / HOD approve-reject / Principal approve-reject ───────────

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"
    );

    const body = (await request.json()) as {
      action: "CANCEL" | "APPROVE" | "REJECT" | "RECALL";
      comments?: string;
      // Required when the HOD is approving an "Others" request - the type they
      // decide is the most suitable to sanction the leave against.
      leaveTypeCode?: LeaveTypeCodeV2;
    };

    const db = getAdminDb();
    const reqRef = REQUESTS_COL(session.collegeId, db).doc(id);
    const snap = await reqRef.get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const req = { id: snap.id, ...snap.data() } as LeaveRequestV2 & { applicantRole?: string };
    const now = new Date();
    const leaveBase = req.applicantRole === "HOD" ? "/hod/leave" : "/panel/leave";

    // ── Employee cancels ─────────────────────────────────────────────────────

    if (body.action === "CANCEL") {
      if (req.employeeId !== session.uid) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      // Cancellable while awaiting the first reviewer's decision - the HOD for
      // normal requests, or the Principal for "Others" requests (which are
      // reviewed by the Principal before the HOD).
      const awaitingFirstReview =
        req.status === "PENDING_HOD" ||
        (req.status === "PENDING_RATIFICATION" && req.isOtherRequest && !req.leaveTypeCode);
      if (!awaitingFirstReview) {
        return NextResponse.json(
          { error: "Only applications awaiting the first reviewer's decision can be cancelled." },
          { status: 409 }
        );
      }

      await reqRef.update({ status: "CANCELLED", updatedAt: now });

      if (req.leaveTypeCode) {
        const year = resolveYear(req.fromDate);
        await releasePendingBalance(db, session.collegeId, session.uid, req.leaveTypeCode, year, req.computedDays);
      }

      return NextResponse.json({ ok: true });
    }

    // ── HOD approve / reject ─────────────────────────────────────────────────

    if (body.action === "APPROVE" || body.action === "REJECT") {
      if (session.role === "HOD" && req.status === "PENDING_HOD") {
        const userSnap = await db
          .collection("colleges").doc(session.collegeId)
          .collection("users").doc(session.uid).get();
        const hodDept = (userSnap.data() as { department?: string })?.department ?? "";
        const hodName = (userSnap.data() as { name?: string })?.name ?? "HOD";

        if (req.department !== hodDept) {
          return NextResponse.json({ error: "This application belongs to a different department." }, { status: 403 });
        }

        // "Others" requests reach the HOD only after the Principal has already
        // given a general go-ahead; the HOD's job here is just to pick the
        // concrete leave type and finalize - no further ratification needed.
        const isOtherFinalStage = !!req.isOtherRequest && !req.leaveTypeCode;

        let effectiveCode = req.leaveTypeCode;
        if (body.action === "APPROVE" && isOtherFinalStage) {
          if (!body.leaveTypeCode) {
            return NextResponse.json(
              { error: "Select which leave type to sanction this request as." },
              { status: 400 }
            );
          }
          effectiveCode = body.leaveTypeCode;
        }
        const ltLabel = labelFor(effectiveCode);
        const sequence = isOtherFinalStage ? 2 : 1; // Others: Principal acted first (sequence 1)

        if (body.action === "REJECT") {
          await reqRef.update({ status: "REJECTED", currentApproverRole: FieldValue.delete(), updatedAt: now });

          await db.collection("colleges").doc(session.collegeId)
            .collection("leaveApprovalSteps").add({
              collegeId: session.collegeId,
              applicationId: id,
              approverRole: "HOD",
              approverId: session.uid,
              approverName: hodName,
              sequence,
              action: "REJECTED",
              comments: body.comments ?? "",
              actedOn: now,
              createdAt: now,
            });

          if (req.leaveTypeCode) {
            const year = resolveYear(req.fromDate);
            await releasePendingBalance(db, session.collegeId, req.employeeId, req.leaveTypeCode, year, req.computedDays);
          }
          await notify(
            db, session.collegeId, req.employeeId,
            "LEAVE_REJECTED",
            `${ltLabel} Leave Rejected`,
            `Your ${ltLabel} leave (${req.computedDays} day${req.computedDays !== 1 ? "s" : ""}) was rejected by ${hodName}.${body.comments ? " Remarks: " + body.comments : ""}`,
            `${leaveBase}/${id}`
          );
          return NextResponse.json({ ok: true });
        }

        const year = resolveYear(req.fromDate);

        if (isOtherFinalStage) {
          // Principal already approved the general request - HOD's type pick is final.
          await reqRef.update({
            status: "APPROVED",
            currentApproverRole: FieldValue.delete(),
            leaveTypeCode: effectiveCode,
            updatedAt: now,
          });

          await db.collection("colleges").doc(session.collegeId)
            .collection("leaveApprovalSteps").add({
              collegeId: session.collegeId,
              applicationId: id,
              approverRole: "HOD",
              approverId: session.uid,
              approverName: hodName,
              sequence: 2,
              action: "APPROVED",
              comments: body.comments ?? "",
              actedOn: now,
              createdAt: now,
            });

          const balRef = LEAVE_COL(session.collegeId, db).doc(
            balanceDocId(req.employeeId, effectiveCode as LeaveTypeCodeV2, year)
          );
          const balSnap2 = await balRef.get();
          if (balSnap2.exists) {
            const balData = balSnap2.data() ?? {};
            await balRef.update({ used: (balData.used ?? 0) + req.computedDays, updatedAt: now });
          }

          await notify(
            db, session.collegeId, req.employeeId,
            "LEAVE_APPROVED",
            `${ltLabel} Leave Approved`,
            `Your ${ltLabel} leave (${req.computedDays} day${req.computedDays !== 1 ? "s" : ""}) has been approved by ${hodName}.`,
            `${leaveBase}/${id}`
          );
          return NextResponse.json({ ok: true });
        }

        // Normal (non-Other) request - decide whether this type still needs
        // Principal/Management ratification, or whether HOD approval is final.
        const approvalChain = await resolveApprovalChain(db, effectiveCode as LeaveTypeCodeV2);
        const needsRatification = approvalChain === "management" || approvalChain === "medical_officer";

        await reqRef.update({
          status: needsRatification ? "PENDING_RATIFICATION" : "APPROVED",
          currentApproverRole: needsRatification ? "PRINCIPAL" : FieldValue.delete(),
          leaveTypeCode: effectiveCode,
          updatedAt: now,
        });

        await db.collection("colleges").doc(session.collegeId)
          .collection("leaveApprovalSteps").add({
            collegeId: session.collegeId,
            applicationId: id,
            approverRole: "HOD",
            approverId: session.uid,
            approverName: hodName,
            sequence: 1,
            action: "APPROVED",
            comments: body.comments ?? "",
            actedOn: now,
            createdAt: now,
          });

        // A normal request already reserved `pending` at submission time, so
        // it only needs to move pending → used (or stay pending if still
        // awaiting ratification).
        const balRef = LEAVE_COL(session.collegeId, db).doc(
          balanceDocId(req.employeeId, effectiveCode as LeaveTypeCodeV2, year)
        );
        const balSnap2 = await balRef.get();
        if (balSnap2.exists && !needsRatification) {
          const balData = balSnap2.data() ?? {};
          await balRef.update({
            pending: Math.max(0, (balData.pending ?? 0) - req.computedDays),
            used: (balData.used ?? 0) + req.computedDays,
            updatedAt: now,
          });
        }
        // else: stays reserved in `pending` until Principal/VP ratifies.

        if (needsRatification) {
          await notify(
            db, session.collegeId, req.employeeId,
            "GENERAL",
            `${ltLabel} Leave - Pending Principal Approval`,
            `Your ${ltLabel} leave (${req.computedDays} day${req.computedDays !== 1 ? "s" : ""}) was approved by ${hodName} and is now awaiting Principal's approval.`,
            `${leaveBase}/${id}`
          );
        } else {
          await notify(
            db, session.collegeId, req.employeeId,
            "LEAVE_APPROVED",
            `${ltLabel} Leave Approved`,
            `Your ${ltLabel} leave (${req.computedDays} day${req.computedDays !== 1 ? "s" : ""}) has been approved by ${hodName}.`,
            `${leaveBase}/${id}`
          );
        }

        return NextResponse.json({ ok: true });
      }

      // ── Principal / VP approve / reject ──────────────────────────────────

      if (
        (session.role === "PRINCIPAL" || session.role === "VICE_PRINCIPAL") &&
        (req.status === "PENDING_RATIFICATION" || req.status === "PENDING_MANAGEMENT")
      ) {
        const principalSnap = await db
          .collection("colleges").doc(session.collegeId)
          .collection("users").doc(session.uid).get();
        const principalName = (principalSnap.data() as { name?: string })?.name
          ?? (session.role === "VICE_PRINCIPAL" ? "Vice Principal" : "Principal");

        // "Others" requests land here first, before the HOD has picked a type -
        // the Principal is only giving a general go-ahead; the HOD finalizes
        // (and picks the actual leave type) afterwards.
        const isOtherFirstStage = !!req.isOtherRequest && !req.leaveTypeCode;

        if (isOtherFirstStage) {
          const ltLabel = "Other";

          if (body.action === "REJECT") {
            await reqRef.update({ status: "REJECTED", currentApproverRole: FieldValue.delete(), updatedAt: now });
            await db.collection("colleges").doc(session.collegeId)
              .collection("leaveApprovalSteps").add({
                collegeId: session.collegeId,
                applicationId: id,
                approverRole: session.role,
                approverId: session.uid,
                approverName: principalName,
                sequence: 1,
                action: "REJECTED",
                comments: body.comments ?? "",
                actedOn: now,
                createdAt: now,
              });
            await notify(
              db, session.collegeId, req.employeeId,
              "LEAVE_REJECTED",
              `${ltLabel} Leave Rejected`,
              `Your leave request (${req.computedDays} day${req.computedDays !== 1 ? "s" : ""}) was rejected by ${principalName}.${body.comments ? " Remarks: " + body.comments : ""}`,
              `${leaveBase}/${id}`
            );
            return NextResponse.json({ ok: true });
          }

          // APPROVE - forward to the HOD to pick the actual leave type.
          await reqRef.update({ status: "PENDING_HOD", currentApproverRole: "HOD", updatedAt: now });
          await db.collection("colleges").doc(session.collegeId)
            .collection("leaveApprovalSteps").add({
              collegeId: session.collegeId,
              applicationId: id,
              approverRole: session.role,
              approverId: session.uid,
              approverName: principalName,
              sequence: 1,
              action: "APPROVED",
              comments: body.comments ?? "",
              actedOn: now,
              createdAt: now,
            });
          await notify(
            db, session.collegeId, req.employeeId,
            "GENERAL",
            "Leave - Pending HOD Review",
            `Your leave request (${req.computedDays} day${req.computedDays !== 1 ? "s" : ""}) was approved by ${principalName} and is now with your HOD to finalize the leave type.`,
            `${leaveBase}/${id}`
          );
          return NextResponse.json({ ok: true });
        }

        const ltLabel = labelFor(req.leaveTypeCode);

        const newStatus = body.action === "APPROVE" ? "APPROVED" : "REJECTED";
        await reqRef.update({ status: newStatus, currentApproverRole: FieldValue.delete(), updatedAt: now });

        await db.collection("colleges").doc(session.collegeId)
          .collection("leaveApprovalSteps").add({
            collegeId: session.collegeId,
            applicationId: id,
            approverRole: session.role,
            approverId: session.uid,
            approverName: principalName,
            sequence: 2,
            action: body.action === "APPROVE" ? "APPROVED" : "REJECTED",
            comments: body.comments ?? "",
            actedOn: now,
            createdAt: now,
          });

        const year = resolveYear(req.fromDate);
        const balRef = LEAVE_COL(session.collegeId, db).doc(
          balanceDocId(req.employeeId, req.leaveTypeCode as LeaveTypeCodeV2, year)
        );
        const balSnap = await balRef.get();
        if (balSnap.exists) {
          const balData = balSnap.data() ?? {};
          if (body.action === "APPROVE") {
            await balRef.update({
              pending: Math.max(0, (balData.pending ?? 0) - req.computedDays),
              used: (balData.used ?? 0) + req.computedDays,
              updatedAt: now,
            });
          } else {
            await balRef.update({
              pending: Math.max(0, (balData.pending ?? 0) - req.computedDays),
              updatedAt: now,
            });
          }
        }

        if (body.action === "APPROVE") {
          await notify(
            db, session.collegeId, req.employeeId,
            "LEAVE_APPROVED",
            `${ltLabel} Leave Approved`,
            `Your ${ltLabel} leave (${req.computedDays} day${req.computedDays !== 1 ? "s" : ""}) has been approved by ${principalName}.`,
            `${leaveBase}/${id}`
          );
        } else {
          await notify(
            db, session.collegeId, req.employeeId,
            "LEAVE_REJECTED",
            `${ltLabel} Leave Rejected`,
            `Your ${ltLabel} leave (${req.computedDays} day${req.computedDays !== 1 ? "s" : ""}) was rejected by ${principalName}.${body.comments ? " Remarks: " + body.comments : ""}`,
            `${leaveBase}/${id}`
          );
        }

        return NextResponse.json({ ok: true });
      }

      return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/applications/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveYear(fromDate: unknown): number {
  if (fromDate && typeof (fromDate as { toDate?: () => Date }).toDate === "function") {
    return (fromDate as { toDate: () => Date }).toDate().getFullYear();
  }
  return new Date(fromDate as string).getFullYear();
}

async function releasePendingBalance(
  db: ReturnType<typeof getAdminDb>,
  collegeId: string,
  uid: string,
  leaveTypeCode: LeaveTypeCodeV2,
  year: number,
  days: number
) {
  const balRef = LEAVE_COL(collegeId, db).doc(balanceDocId(uid, leaveTypeCode, year));
  const balSnap = await balRef.get();
  if (balSnap.exists) {
    const balData = balSnap.data() ?? {};
    await balRef.update({
      pending: Math.max(0, (balData.pending ?? 0) - days),
      updatedAt: new Date(),
    });
  }
}
