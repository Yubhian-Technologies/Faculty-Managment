export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type {
  LeaveTypeCodeV2,
  EmployeeLeaveProfile,
  LeaveTypeFull,
  LeaveBalanceV2,
} from "@/types/leave";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";
import { countLeaveDays } from "@/lib/leave/dayCounter";
import { runRuleEngine, buildValidationContext } from "@/lib/leave/ruleEngine";
import {
  PROFILES_COL,
  REQUESTS_COL,
  LEAVE_COL,
  balanceDocId,
} from "@/lib/leave/balanceEngine";

// ─── GET — list leave requests for current user ───────────────────────────────

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "SUPER_ADMIN"
    );

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const dept = searchParams.get("dept");

    const db = getAdminDb();
    const col = REQUESTS_COL(session.collegeId, db);

    let snap;
    if (session.role === "HOD" && dept === "true") {
      // HOD sees their dept's pending requests
      const userSnap = await db
        .collection("colleges").doc(session.collegeId)
        .collection("users").doc(session.uid).get();
      const hodDept = (userSnap.data() as { department?: string })?.department ?? "";
      snap = await col
        .where("department", "==", hodDept)
        .where("status", "==", "PENDING_HOD")
        .get();
    } else if (session.role === "PRINCIPAL" || session.role === "VICE_PRINCIPAL") {
      snap = status
        ? await col.where("status", "==", status).get()
        : await col.get();
    } else {
      // Employee sees own requests
      snap = status
        ? await col.where("employeeId", "==", session.uid).where("status", "==", status).get()
        : await col.where("employeeId", "==", session.uid).get();
    }

    type LeaveReqDoc = Record<string, unknown> & { id: string };
    const requests: LeaveReqDoc[] = snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeaveReqDoc));

    requests.sort((a, b) => {
      const getMs = (val: unknown) => {
        if (val && typeof (val as { toMillis?: () => number }).toMillis === "function") {
          return (val as { toMillis: () => number }).toMillis();
        }
        return val ? new Date(val as string).getTime() : 0;
      };
      return getMs(b.createdAt) - getMs(a.createdAt);
    });

    return NextResponse.json({ requests });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/applications GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ─── POST — submit a new leave request ───────────────────────────────────────

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "VICE_PRINCIPAL", "PRINCIPAL", "SUPER_ADMIN"
    );

    const body = (await request.json()) as {
      leaveTypeCode: LeaveTypeCodeV2;
      fromDate: string;
      toDate: string;
      isHalfDay?: boolean;
      halfDaySession?: "MORNING" | "AFTERNOON";
      reason: string;
      leaveAddress: string;
      contactNumber: string;
      substituteArrangement?: string;
      otherEmploymentAck?: boolean;
      medicalCertificateUrl?: string;
    };

    const { leaveTypeCode, fromDate, toDate, reason, leaveAddress, contactNumber } = body;

    if (!leaveTypeCode || !fromDate || !toDate || !reason || !leaveAddress || !contactNumber) {
      return NextResponse.json(
        { error: "leaveTypeCode, fromDate, toDate, reason, leaveAddress, contactNumber are required" },
        { status: 400 }
      );
    }

    const db = getAdminDb();

    // Load leave type config (from Firestore or seed fallback)
    const ltSnap = await db.collection("leaveTypes").doc(leaveTypeCode).get();
    const leaveType: LeaveTypeFull = ltSnap.exists
      ? ({ id: ltSnap.id, ...ltSnap.data() } as LeaveTypeFull)
      : (LEAVE_TYPE_SEED.find((l) => l.code === leaveTypeCode) as LeaveTypeFull);

    if (!leaveType) {
      return NextResponse.json({ error: "Unknown leave type" }, { status: 400 });
    }

    // Load employee profile
    const profileSnap = await PROFILES_COL(session.collegeId, db).doc(session.uid).get();
    if (!profileSnap.exists) {
      return NextResponse.json(
        { error: "Leave profile not set up. Please contact HR to initialize your leave profile." },
        { status: 422 }
      );
    }
    const profile = { id: profileSnap.id, ...profileSnap.data() } as EmployeeLeaveProfile;

    const from = new Date(fromDate);
    const to = new Date(toDate);

    if (body.isHalfDay) {
      // Half-day: 0.5, no need for holiday lookup
    }

    // Fetch holidays for the leave period from college's holiday calendar
    const holidayDates = new Set<string>();
    try {
      const hSnap = await db
        .collection("colleges").doc(session.collegeId)
        .collection("holidays")
        .get();
      hSnap.docs.forEach((d) => {
        const data = d.data() as { date?: { toDate?: () => Date } | string };
        if (data.date) {
          const dt = typeof data.date === "string"
            ? new Date(data.date)
            : data.date.toDate?.() ?? new Date();
          const y = dt.getFullYear();
          const m = String(dt.getMonth() + 1).padStart(2, "0");
          const day = String(dt.getDate()).padStart(2, "0");
          holidayDates.add(`${y}-${m}-${day}`);
        }
      });
    } catch { /* non-fatal — proceed without holidays */ }

    const computedDays = body.isHalfDay
      ? 0.5
      : countLeaveDays(from, to, {
          excludeHolidaysAndSundays: leaveType.rules.excludeHolidaysAndSundays ?? false,
          holidayDates,
        });

    if (computedDays <= 0) {
      return NextResponse.json(
        { error: "Leave period results in zero working days (all days are holidays/Sundays)." },
        { status: 400 }
      );
    }

    // Load current balance
    const year = from.getFullYear();
    const balSnap = await LEAVE_COL(session.collegeId, db)
      .doc(balanceDocId(session.uid, leaveTypeCode, year))
      .get();
    const currentBalance = balSnap.exists
      ? ({ id: balSnap.id, ...balSnap.data() } as LeaveBalanceV2)
      : null;

    // Run rule engine
    const ctx = buildValidationContext({
      fromDate: from,
      toDate: to,
      computedDays,
      leaveType,
      profile,
      currentBalance,
      holidayDates,
    });
    const { errors, canSubmit } = runRuleEngine(ctx);

    if (!canSubmit) {
      return NextResponse.json({ error: errors[0]?.message ?? "Validation failed", errors }, { status: 422 });
    }

    // Look up employee name + department
    const userSnap = await db
      .collection("colleges").doc(session.collegeId)
      .collection("users").doc(session.uid).get();
    const userData = userSnap.data() as { name?: string; department?: string } | undefined;

    const now = new Date();

    const ref = await REQUESTS_COL(session.collegeId, db).add({
      collegeId: session.collegeId,
      employeeId: session.uid,
      employeeName: userData?.name ?? "Unknown",
      department: userData?.department ?? profile.department ?? "",
      leaveTypeCode,
      fromDate: from,
      toDate: to,
      computedDays,
      isHalfDay: body.isHalfDay ?? false,
      ...(body.halfDaySession ? { halfDaySession: body.halfDaySession } : {}),
      reason,
      leaveAddress,
      contactNumber,
      ...(body.substituteArrangement ? { substituteArrangement: body.substituteArrangement } : {}),
      otherEmploymentAck: body.otherEmploymentAck ?? false,
      ...(body.medicalCertificateUrl ? { medicalCertificateUrl: body.medicalCertificateUrl } : {}),
      applicantRole: session.role,
      status: "PENDING_HOD",
      currentApproverRole: "HOD",
      appliedOn: now,
      createdAt: now,
      updatedAt: now,
    });

    // Reserve pending days in balance (if balance exists)
    if (balSnap.exists) {
      const balRef = LEAVE_COL(session.collegeId, db).doc(balanceDocId(session.uid, leaveTypeCode, year));
      const balData = balSnap.data() ?? {};
      await balRef.update({
        pending: (balData.pending ?? 0) + computedDays,
        updatedAt: now,
      });
    }

    return NextResponse.json({ id: ref.id, computedDays }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/applications POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
