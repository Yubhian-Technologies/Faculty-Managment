export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Firestore } from "firebase-admin/firestore";
import type { FinancePurchaseClearance } from "@/types";

async function getUserProfile(db: Firestore, collegeId: string, uid: string): Promise<{ name: string; department: string }> {
  try {
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
    const data = snap.data() as { name?: string; department?: string } | undefined;
    return { name: data?.name ?? "Unknown", department: data?.department ?? "" };
  } catch {
    return { name: "Unknown", department: "" };
  }
}

async function notify(
  db: Firestore,
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
  } catch {
    /* non-fatal */
  }
}

async function notifyRole(db: Firestore, collegeId: string, role: string, type: string, title: string, message: string, link?: string) {
  const snap = await db.collection("colleges").doc(collegeId).collection("users").where("role", "==", role).get();
  for (const u of snap.docs) {
    await notify(db, collegeId, u.id, type, title, message, link);
  }
}

// Purchase clearance records only carry a `department` string, not a specific
// HOD uid (unlike Budget/Indent requests), so notifying "the HOD" means looking
// up whichever user(s) hold role HOD for that department.
async function notifyDeptHod(db: Firestore, collegeId: string, department: string, type: string, title: string, message: string, link?: string) {
  const snap = await db.collection("colleges").doc(collegeId).collection("users")
    .where("role", "==", "HOD").where("department", "==", department).get();
  for (const u of snap.docs) {
    await notify(db, collegeId, u.id, type, title, message, link);
  }
}

const FINANCE_VALID_ACTIONS = ["APPROVED", "REJECTED", "RETURNED", "GOODS_PURCHASED"];

const ACTION_TO_AUDIT: Record<string, string> = {
  APPROVED: "PURCHASE_CLEARANCE_APPROVED",
  REJECTED: "PURCHASE_CLEARANCE_REJECTED",
  RETURNED: "PURCHASE_CLEARANCE_RETURNED",
  GOODS_PURCHASED: "PURCHASE_CLEARANCE_GOODS_PURCHASED",
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("FINANCE", "HOD", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as {
      action?: "APPROVED" | "REJECTED" | "RETURNED" | "GOODS_PURCHASED" | "UPLOAD_GRN";
      remarks?: string;
      grnUrl?: string;
      grnFileName?: string;
      grnNumber?: string;
      grnMessage?: string;
    };

    const db = getAdminDb();
    const ref = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financePurchaseClearance")
      .doc(id);
    const snap = await ref.get();
    if (!snap.exists || (snap.data() as { collegeId?: string })?.collegeId !== session.collegeId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const existing = { id: snap.id, ...snap.data() } as FinancePurchaseClearance;
    const now = new Date();

    // ── HOD confirms receipt with a GRN ─────────────────────────────────────

    if (session.role === "HOD") {
      if (body.action !== "UPLOAD_GRN") {
        return NextResponse.json({ error: "action must be UPLOAD_GRN" }, { status: 400 });
      }

      const { name: hodName, department: hodDept } = await getUserProfile(db, session.collegeId, session.uid);
      if (existing.department !== hodDept) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (existing.status !== "GOODS_PURCHASED") {
        return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
      }
      if (!body.grnUrl || !body.grnNumber || !body.grnMessage) {
        return NextResponse.json({ error: "grnUrl, grnNumber, and grnMessage are all required" }, { status: 400 });
      }

      const historyEntry = {
        action: "COMPLETED" as const,
        by: session.uid,
        byName: hodName,
        byRole: "HOD" as const,
        at: now,
      };

      await ref.update({
        status: "COMPLETED",
        grnUrl: body.grnUrl,
        grnFileName: body.grnFileName ?? null,
        grnNumber: body.grnNumber,
        grnMessage: body.grnMessage,
        grnUploadedBy: session.uid,
        grnUploadedByName: hodName,
        grnUploadedAt: now,
        history: [...(existing.history ?? []), historyEntry],
        updatedAt: now,
      });

      await db.collection("colleges").doc(session.collegeId).collection("financeAuditLogs").add({
        collegeId: session.collegeId,
        action: "PURCHASE_CLEARANCE_GRN_UPLOADED",
        performedBy: session.uid,
        performedByName: hodName,
        targetId: id,
        details: { department: existing.department, grnNumber: body.grnNumber },
        timestamp: now,
      });

      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "PURCHASE_CLEARANCE_GRN_UPLOADED",
        performedBy: session.uid,
        performedByName: hodName,
        targetId: id,
        details: { department: existing.department, items: existing.items, grnNumber: body.grnNumber },
        timestamp: now,
      });

      const notifMessage = `${hodName} confirmed goods received for "${existing.items}" (${existing.department}). GRN #${body.grnNumber}.`;
      await notifyRole(db, session.collegeId, "FINANCE", "PURCHASE_CLEARANCE_GRN_UPLOADED", "GRN Uploaded", notifMessage, "/finance/purchase-clearance");

      return NextResponse.json({ success: true });
    }

    // ── Finance/Super Admin: approve / reject / return, or mark goods purchased ──

    const action = body.action;
    if (!action || !FINANCE_VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: 'action must be "APPROVED", "REJECTED", "RETURNED", or "GOODS_PURCHASED"' },
        { status: 400 }
      );
    }

    if (action === "GOODS_PURCHASED") {
      if (existing.status !== "APPROVED") {
        return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
      }
    } else if (existing.status !== "PENDING") {
      return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
    }

    const { name: byName } = await getUserProfile(db, session.collegeId, session.uid);
    const historyEntry = {
      action,
      by: session.uid,
      byName,
      byRole: "FINANCE" as const,
      at: now,
      ...(body.remarks !== undefined && { remarks: body.remarks }),
    };

    await ref.update({
      status: action,
      ...(action !== "GOODS_PURCHASED" && { financeComments: body.remarks ?? "" }),
      history: [...(existing.history ?? []), historyEntry],
      updatedAt: now,
    });

    await db.collection("colleges").doc(session.collegeId).collection("financeAuditLogs").add({
      collegeId: session.collegeId,
      action: ACTION_TO_AUDIT[action],
      performedBy: session.uid,
      performedByName: byName,
      targetId: id,
      details: body.remarks !== undefined ? { remarks: body.remarks } : {},
      timestamp: now,
    });

    if (action === "GOODS_PURCHASED") {
      await notifyDeptHod(
        db, session.collegeId, existing.department,
        "PURCHASE_CLEARANCE_GOODS_PURCHASED", "Goods Purchased — Upload GRN",
        `Finance marked "${existing.items}" (${existing.department}) as goods purchased. Upload the GRN to confirm receipt.`,
        "/hod/purchase-clearance"
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-purchase-clearance/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
