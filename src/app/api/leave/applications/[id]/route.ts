export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { canAccessLeaveProfile } from "@/lib/leave/access";
import { resolveUserDepartment } from "@/lib/budget/departmentScope";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { REQUESTS_COL, commitApproval, releasePending, releaseApproval, splitLeaveDays } from "@/lib/leave/balanceEngine";
import { decideFinalStageLeave } from "@/lib/leave/decideFinalStage";
import { getHolidayDateKeys } from "@/lib/leave/holidaysCount";
import { resolveStaffGender } from "@/lib/leave/identity";
import { OTHER_CATEGORIES_COL } from "@/lib/leave/otherCategories";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";
import { notify, notifyRole } from "@/lib/notify";
import { emitWorkflowNotification } from "@/lib/notifications/workflowNotifications";
import { validatePeriodSubstitutions, notifySubstitutes, type PeriodSubstitutionInput } from "@/lib/leave/periodCoverage";
import { notifyAdjustmentAssignees, mergeSubstituteEntry } from "@/lib/leave/adjustmentRequests";
import { resolveLoginUidForFacultyMember } from "@/lib/faculty/resolveFacultyMemberId";
import { OTHER_LEAVE_CATEGORY_ORDER } from "@/types/leave";
import type { AdjustmentRequest, LeaveRequest, LeaveActionRecord, OtherLeaveCategory } from "@/types/leave";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
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
      "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
    );
    const body = (await request.json()) as {
      action?: "APPROVE" | "REJECT" | "CANCEL" | "PROPOSE_COVERAGE" | "REVISE_ADJUSTMENT";
      remarks?: string;
      isPaidLeave?: boolean;
      otherLeaveCategory?: OtherLeaveCategory;
      reason?: string;
      periodSubstitutions?: PeriodSubstitutionInput[];
      // REVISE_ADJUSTMENT only - which declined entry to replace, and who to
      // replace it with.
      declinedAssigneeUid?: string;
      newSubstituteFacultyId?: string;
      newHandoverUid?: string;
    };
    if (!body.action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }
    if (body.action === "CANCEL" && !body.reason?.trim()) {
      return NextResponse.json({ error: "A reason is required to cancel a leave request" }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = REQUESTS_COL(session.collegeId, db).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const req = { id: snap.id, ...snap.data() } as LeaveRequest;

    const now = new Date();
    const year = (req.fromDate as unknown as { toDate(): Date }).toDate().getFullYear();

    // ─── Cancel (requester only) ─────────────────────────────────────────────
    // Works both while still pending (any stage - HOD/Principal/Management)
    // and after it's already been APPROVED, as long as the leave period
    // itself hasn't finished yet - cancelling something already lived
    // through doesn't make sense. Only the original requester can do this,
    // at either point.
    if (body.action === "CANCEL") {
      if (req.uid !== session.uid) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (req.isLateAttendancePenalty) {
        return NextResponse.json({ error: "This is an automatic attendance-penalty deduction and cannot be cancelled" }, { status: 400 });
      }
      const wasApproved = req.status === "APPROVED";
      if (
        req.status !== "PENDING_ACCEPTANCE" && req.status !== "PENDING_HOD" && req.status !== "PENDING_PRINCIPAL" &&
        req.status !== "PENDING_MANAGEMENT" && !wasApproved
      ) {
        return NextResponse.json({ error: "Only a pending or approved request can be cancelled" }, { status: 400 });
      }
      if (wasApproved) {
        const toD = (req.toDate as unknown as { toDate(): Date }).toDate();
        const toEnd = new Date(toD.getFullYear(), toD.getMonth(), toD.getDate(), 23, 59, 59, 999);
        if (toEnd < now) {
          return NextResponse.json({ error: "This leave has already been completed and can no longer be cancelled" }, { status: 400 });
        }
      }
      if (req.leaveTypeCode) {
        const lt = LEAVE_TYPE_SEED.find((t) => t.code === req.leaveTypeCode);
        if (lt && !lt.rules.unlimited) {
          if (wasApproved) {
            // Restore whatever days approval had committed to `used` -
            // the extra beyond balance (lopDays) was never committed in the
            // first place, so only the within-balance portion is reversed.
            const committedDays = req.totalDays - (req.lopDays ?? 0);
            if (committedDays > 0) {
              await releaseApproval(db, session.collegeId, req.uid, req.leaveTypeCode, year, committedDays);
            }
          } else {
            await releasePending(db, session.collegeId, req.uid, req.leaveTypeCode, year, req.totalDays);
          }
        }
      }
      const cancelReason = body.reason!.trim();
      await ref.update({ status: "CANCELLED", cancelReason, updatedAt: now });
      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId, action: "LEAVE_CANCELLED", performedBy: session.uid,
        performedByName: req.employeeName, targetId: id, details: { wasApproved, cancelReason }, timestamp: now,
      });

      // Tell whoever sits above this requester in the approval chain - same
      // routing rule applications/route.ts POST uses to decide where a fresh
      // request lands (PANEL_MEMBER/departmental COLLEGE_STAFF -> their HOD,
      // PRINCIPAL -> MANAGEMENT (no one else within the college), everyone
      // else -> Principal/VP tier) - so the reason is visible to them even if
      // they never re-open this person's history.
      const message = `${req.employeeName} cancelled their ${wasApproved ? "approved" : "pending"} leave request (${req.totalDays} day(s)). Reason: ${cancelReason}`;
      const reportsToHod = session.role === "PANEL_MEMBER" || (session.role === "COLLEGE_STAFF" && !!req.department);
      if (reportsToHod && req.department) {
        const deptSnap = await db.collection("colleges").doc(session.collegeId).collection("departments")
          .where("name", "==", req.department).limit(1).get();
        const hodUid = (deptSnap.docs[0]?.data() as { hodUid?: string } | undefined)?.hodUid;
        if (hodUid) {
          await notify(db, session.collegeId, hodUid, "LEAVE_CANCELLED", "Leave Request Cancelled", message, `/hod/leave-history/${req.uid}`);
        }
      } else if (session.role === "PRINCIPAL") {
        await notifyRole(db, session.collegeId, "MANAGEMENT", "LEAVE_CANCELLED", "Leave Request Cancelled", message);
      } else {
        await notifyRole(db, session.collegeId, "PRINCIPAL", "LEAVE_CANCELLED", "Leave Request Cancelled", message, "/principal/leave-approvals");
        await notifyRole(db, session.collegeId, "VICE_PRINCIPAL", "LEAVE_CANCELLED", "Leave Request Cancelled", message, "/principal/leave-approvals");
      }

      return NextResponse.json({ ok: true });
    }

    // ─── Revise a declined adjustment pick (requester only) ─────────────────
    // Once a named substitute/handover person declines (see
    // /api/leave/applications/[id]/adjustment-response), the request stays at
    // PENDING_ACCEPTANCE and the requester picks someone else here for that
    // one declined slot - untouched (still-PENDING or already-ACCEPTED)
    // entries are left exactly as they are.
    if (body.action === "REVISE_ADJUSTMENT") {
      if (req.uid !== session.uid) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (req.status !== "PENDING_ACCEPTANCE") {
        return NextResponse.json({ error: "This request is no longer awaiting acceptance" }, { status: 400 });
      }
      const declined = (req.adjustmentRequests ?? []).find(
        (a) => a.assigneeUid === body.declinedAssigneeUid && a.status === "DECLINED"
      );
      if (!declined) {
        return NextResponse.json({ error: "No declined pick found to revise" }, { status: 400 });
      }

      let periodSubstitutions = req.periodSubstitutions;
      let handoverToUid = req.handoverToUid;
      let handoverToName = req.handoverToName;
      // Everything except the declined entry, to start - the SUBSTITUTE
      // branch below re-adds it back with just its still-ACCEPTED periods
      // (if any), since a decline never touches periods this same person
      // already accepted within the same bundle.
      let adjustmentRequests = (req.adjustmentRequests ?? []).filter((a) => a.assigneeUid !== declined.assigneeUid);
      let newEntry: AdjustmentRequest;

      if (declined.kind === "SUBSTITUTE") {
        if (!body.newSubstituteFacultyId || !req.department) {
          return NextResponse.json({ error: "newSubstituteFacultyId is required" }, { status: 400 });
        }
        const declinedPeriods = (declined.periods ?? []).filter((p) => p.status === "DECLINED");
        const acceptedPeriods = (declined.periods ?? []).filter((p) => p.status === "ACCEPTED");
        if (declinedPeriods.length === 0) {
          return NextResponse.json({ error: "Nothing declined on this pick to revise" }, { status: 400 });
        }
        if (acceptedPeriods.length > 0) {
          // The declined person's still-accepted periods stay theirs -
          // reassigning is only for the ones they turned down.
          adjustmentRequests.push({ ...declined, periods: acceptedPeriods, status: "ACCEPTED" });
        }

        const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, req.uid);
        const reqFromDate = (req.fromDate as unknown as { toDate(): Date }).toDate();
        const reqToDate = (req.toDate as unknown as { toDate(): Date }).toDate();
        const holidayDates = await getHolidayDateKeys(db, session.collegeId, reqFromDate, reqToDate);
        const result = await validatePeriodSubstitutions({
          db, collegeId: session.collegeId, facultyMemberId, department: req.department,
          fromDate: reqFromDate, toDate: reqToDate, holidayDates,
          submitted: declinedPeriods.map((p) => ({ date: p.date, timetableSlotId: p.timetableSlotId, substituteFacultyId: body.newSubstituteFacultyId! })),
          mode: "PARTIAL",
        });
        if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }
        const byKey = new Map((req.periodSubstitutions ?? []).map((p) => [`${p.date}|${p.timetableSlotId}`, p]));
        for (const p of result.resolved) byKey.set(`${p.date}|${p.timetableSlotId}`, p);
        periodSubstitutions = Array.from(byKey.values());

        const newUid = await resolveLoginUidForFacultyMember(db, session.collegeId, body.newSubstituteFacultyId);
        if (!newUid || newUid === body.newSubstituteFacultyId) {
          return NextResponse.json({ error: "That faculty member has no login yet and can't be asked to accept" }, { status: 400 });
        }
        const newPeriods = result.resolved.map((p) => ({ date: p.date, timetableSlotId: p.timetableSlotId, status: "PENDING" as const }));
        // The new pick might already be covering OTHER periods on this same
        // leave - merge rather than create a second entry for them, so they
        // still only ever see one combined request.
        const existingForNewUid = adjustmentRequests.find((a) => a.assigneeUid === newUid && a.kind === "SUBSTITUTE");
        if (existingForNewUid) {
          adjustmentRequests = adjustmentRequests.filter((a) => a !== existingForNewUid);
          newEntry = { ...existingForNewUid, periods: [...(existingForNewUid.periods ?? []), ...newPeriods], status: "PENDING" };
        } else {
          newEntry = {
            kind: "SUBSTITUTE", assigneeUid: newUid,
            assigneeName: result.resolved[0]?.substituteFacultyName ?? "Unknown",
            assigneeFacultyId: body.newSubstituteFacultyId, periods: newPeriods, status: "PENDING",
          };
        }
      } else {
        if (!body.newHandoverUid) {
          return NextResponse.json({ error: "newHandoverUid is required" }, { status: 400 });
        }
        if (body.newHandoverUid === req.uid) {
          return NextResponse.json({ error: "You can't hand over to yourself" }, { status: 400 });
        }
        const handoverSnap = await db.collection("colleges").doc(session.collegeId)
          .collection("users").doc(body.newHandoverUid).get();
        const handoverData = handoverSnap.data() as { name?: string; department?: string } | undefined;
        if (!handoverSnap.exists || !req.department || handoverData?.department !== req.department) {
          return NextResponse.json({ error: "Pick a handover contact from your own department" }, { status: 400 });
        }
        handoverToUid = body.newHandoverUid;
        handoverToName = handoverData?.name ?? "Unknown";
        newEntry = { kind: "HANDOVER", assigneeUid: handoverToUid, assigneeName: handoverToName, status: "PENDING" };
      }

      adjustmentRequests = adjustmentRequests.concat(newEntry);

      await ref.update({
        adjustmentRequests,
        ...(periodSubstitutions ? { periodSubstitutions } : {}),
        ...(handoverToUid ? { handoverToUid, handoverToName } : {}),
        updatedAt: now,
      });
      await notifyAdjustmentAssignees(db, session.collegeId, { ...req, adjustmentRequests });
      return NextResponse.json({ ok: true });
    }

    // ─── Propose coverage (HOD/Principal naming a NEW substitute) ───────────
    // Two callers: an HOD/Principal overriding a pick while a standard
    // request is still PENDING_HOD (previously bundled straight into the
    // same APPROVE call - see LeaveApprovalQueue.tsx), or revisiting an
    // already-APPROVED leave after the timetable added a period that was
    // never part of the original snapshot (buildPeriodCoverage picks up any
    // newly-added one automatically - see AdjustCoverageDialog.tsx). Either
    // way this only PROPOSES - re-validated fresh against current
    // availability, but a genuinely new/changed pick still needs that
    // person's own acceptance (see pendingPeriodSubstitutions in
    // types/leave.ts) before it actually takes effect on periodSubstitutions
    // (and the timetable). A period whose submitted pick is unchanged from
    // what's already recorded is a no-op here - re-approving your own
    // already-accepted picks doesn't ask anyone again.
    if (body.action === "PROPOSE_COVERAGE") {
      if (req.status !== "PENDING_HOD" && req.status !== "APPROVED") {
        return NextResponse.json({ error: "Coverage can only be proposed while pending HOD decision or already approved" }, { status: 400 });
      }
      if (session.role === "HOD") {
        const hodDept = await resolveUserDepartment(db, session.collegeId, session.uid);
        if (!hodDept || req.department !== hodDept) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      } else if (session.role !== "PRINCIPAL" && session.role !== "VICE_PRINCIPAL") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!body.periodSubstitutions?.length) {
        return NextResponse.json({ error: "periodSubstitutions is required" }, { status: 400 });
      }
      if (!req.department) {
        return NextResponse.json({ error: "This request has no department to resolve coverage against" }, { status: 400 });
      }

      const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, req.uid);
      const reqFromDate = (req.fromDate as unknown as { toDate(): Date }).toDate();
      const reqToDate = (req.toDate as unknown as { toDate(): Date }).toDate();
      const holidayDates = await getHolidayDateKeys(db, session.collegeId, reqFromDate, reqToDate);
      const result = await validatePeriodSubstitutions({
        db, collegeId: session.collegeId, facultyMemberId, department: req.department,
        fromDate: reqFromDate, toDate: reqToDate, holidayDates,
        submitted: body.periodSubstitutions, mode: "PARTIAL",
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      const currentByKey = new Map((req.periodSubstitutions ?? []).map((p) => [`${p.date}|${p.timetableSlotId}`, p]));
      const changed = result.resolved.filter((p) => currentByKey.get(`${p.date}|${p.timetableSlotId}`)?.substituteFacultyId !== p.substituteFacultyId);
      if (changed.length === 0) {
        return NextResponse.json({ ok: true, changed: false });
      }

      const byFacultyId = new Map<string, { name: string; periods: typeof changed }>();
      for (const p of changed) {
        const entry = byFacultyId.get(p.substituteFacultyId) ?? { name: p.substituteFacultyName, periods: [] };
        entry.periods.push(p);
        byFacultyId.set(p.substituteFacultyId, entry);
      }
      let adjustmentRequests = req.adjustmentRequests ?? [];
      for (const [facultyId, { name, periods: facultyPeriods }] of byFacultyId) {
        const uid = await resolveLoginUidForFacultyMember(db, session.collegeId, facultyId);
        if (!uid || uid === facultyId) continue; // not provisioned with a login yet - nothing to ask
        adjustmentRequests = mergeSubstituteEntry(
          adjustmentRequests, { uid, name, facultyId },
          facultyPeriods.map((p) => ({ date: p.date, timetableSlotId: p.timetableSlotId, status: "PENDING" as const }))
        );
      }

      const pendingByKey = new Map((req.pendingPeriodSubstitutions ?? []).map((p) => [`${p.date}|${p.timetableSlotId}`, p]));
      for (const p of changed) pendingByKey.set(`${p.date}|${p.timetableSlotId}`, p);
      const pendingPeriodSubstitutions = Array.from(pendingByKey.values());

      await ref.update({ adjustmentRequests, pendingPeriodSubstitutions, updatedAt: now });
      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId, action: "LEAVE_COVERAGE_PROPOSED", performedBy: session.uid,
        performedByName: session.email || session.role, targetId: id, details: { changedCount: changed.length }, timestamp: now,
      });
      await notifyAdjustmentAssignees(db, session.collegeId, { ...req, adjustmentRequests });
      return NextResponse.json({ ok: true, changed: true });
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
      // Naming a NEW substitute (overriding a pick, or - for an Other
      // request - the HOD adding one for the first time) is a separate step
      // now (see PROPOSE_COVERAGE above) - that person must accept before
      // this can go through, so neither branch below still takes
      // periodSubstitutions inline.
      if (req.pendingPeriodSubstitutions?.length) {
        return NextResponse.json(
          { error: "Some substitute changes on this request are still awaiting acceptance" },
          { status: 400 }
        );
      }
      if (req.isOtherRequest) {
        if (typeof body.isPaidLeave !== "boolean") {
          return NextResponse.json({ error: "isPaidLeave is required to forward an Other request" }, { status: 400 });
        }
        actionRecord.isPaidLeave = body.isPaidLeave;

        await ref.update({
          status: "PENDING_PRINCIPAL", isPaidLeave: body.isPaidLeave, hodAction: actionRecord, updatedAt: now,
        });
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
      // blocks this - the excess becomes Loss of Pay instead. Coverage is
      // whatever's already on record - the requester's own accepted
      // submission-time picks, plus any HOD override that's already cleared
      // PROPOSE_COVERAGE's acceptance gate above.
      const periodSubstitutions = req.periodSubstitutions;

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
      await ref.update({
        status: "APPROVED", hodAction: actionRecord, lopDays, updatedAt: now,
        ...(periodSubstitutions ? { periodSubstitutions } : {}),
      });
      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId, action: "LEAVE_HOD_APPROVED", performedBy: session.uid,
        performedByName: session.email || "HOD", targetId: id, details: { lopDays }, timestamp: now,
      });
      await notify(db, session.collegeId, req.uid, "LEAVE_APPROVED", "Leave Request Approved",
        `Your leave request for ${req.totalDays} day(s) was approved by your HOD` +
          (lopDays > 0 ? ` — ${lopDays} day(s) exceed your balance and will be treated as Loss of Pay.` : "."),
        "/panel/leave");
      // Notified against the FINAL periodSubstitutions (post-adjustment),
      // not the stale `req` read at the top of this handler - otherwise an
      // HOD override here would notify the requester's original pick
      // instead of whoever's actually covering now.
      await notifySubstitutes(db, session.collegeId, { ...req, periodSubstitutions });
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
      // Approving an "Other" request is also where the Principal categorizes
      // it (Maternity/Family Planning/Quarantine/Extraordinary/Compensatory)
      // for their own record - required, not optional, and stored separately
      // from the request itself (see OTHER_CATEGORIES_COL) so it's never
      // visible anywhere else.
      if (body.action === "APPROVE" && req.isOtherRequest) {
        if (!body.otherLeaveCategory || !OTHER_LEAVE_CATEGORY_ORDER.includes(body.otherLeaveCategory)) {
          return NextResponse.json(
            { error: "Select a leave category (Maternity, Family Planning, Quarantine, Extraordinary, or Compensatory) before approving" },
            { status: 400 }
          );
        }
        // Maternity applies to female staff only. The picker already hides it
        // for everyone else (LeaveApprovalQueue), but that's presentation -
        // this is the guard, so a direct API call can't set it either. Read
        // live from the requester's user record rather than from anything
        // copied onto the request, matching how the queue decides what to
        // offer. A requester with no gender recorded is not eligible: the
        // college should record it rather than have the app assume.
        if (body.otherLeaveCategory === "MATERNITY") {
          const gender = await resolveStaffGender(db, session.collegeId, req.uid);
          if (gender !== "Female") {
            return NextResponse.json(
              { error: "Maternity leave applies to female staff only" },
              { status: 400 }
            );
          }
        }
        // Normally an HOD already tagged paid/unpaid when forwarding it here.
        // A Vice Principal's own Other leave skips the HOD stage entirely
        // though, landing here untagged - the Principal decides it themselves.
        if (req.isPaidLeave === undefined && typeof body.isPaidLeave !== "boolean") {
          return NextResponse.json({ error: "Select paid or unpaid before approving" }, { status: 400 });
        }
      }
      await decideFinalStageLeave({
        db, collegeId: session.collegeId, id, req,
        action: body.action, remarks: body.remarks,
        decidedByUid: session.uid, decidedByEmail: session.email,
        decider: "PRINCIPAL",
        isPaidLeave: body.isPaidLeave,
      });
      if (body.action === "APPROVE" && req.isOtherRequest && body.otherLeaveCategory) {
        await OTHER_CATEGORIES_COL(session.collegeId, db).doc(id).set({
          id,
          collegeId: session.collegeId,
          uid: req.uid,
          category: body.otherLeaveCategory,
          setBy: session.uid,
          setByName: session.email || "Principal",
          setAt: new Date(),
        });
      }
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
