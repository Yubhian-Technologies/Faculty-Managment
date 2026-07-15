export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Firestore } from "firebase-admin/firestore";
import type { FinancePurchaseClearance, PurchaseQuotation } from "@/types";

const MIN_QUOTATIONS = 3;

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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PURCHASE_DEPT", "FINANCE", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as {
      action?: "RESUBMIT" | "REJECT" | "RETURN" | "SEND_TO_FINANCE" | "GOODS_PURCHASED" | "APPROVE" | "UPLOAD_GRN";
      remarks?: string;
      items?: string;
      estimatedAmount?: number;
      quotations?: PurchaseQuotation[];
      selectedQuotationId?: string;
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

    // ── HOD: resubmit after being returned, or upload the GRN once purchased ──

    if (session.role === "HOD") {
      if (existing.hodUid !== session.uid) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      if (body.action === "RESUBMIT") {
        if (existing.status !== "RETURNED_TO_HOD") {
          return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
        }
        if (!body.items || !body.estimatedAmount) {
          return NextResponse.json({ error: "items and estimatedAmount are required" }, { status: 400 });
        }

        const { name: hodName } = await getUserProfile(db, session.collegeId, session.uid);
        const historyEntry = {
          action: "PENDING_PURCHASE_REVIEW" as const,
          by: session.uid,
          byName: hodName,
          byRole: "HOD" as const,
          at: now,
        };

        await ref.update({
          items: body.items,
          estimatedAmount: Number(body.estimatedAmount),
          status: "PENDING_PURCHASE_REVIEW",
          history: [...(existing.history ?? []), historyEntry],
          updatedAt: now,
        });

        await notifyRole(
          db, session.collegeId, "PURCHASE_DEPT",
          "PURCHASE_CLEARANCE_SUBMITTED", "Purchase Clearance Resubmitted",
          `${hodName} resubmitted the purchase clearance request "${body.items}" for ${existing.department}.`,
          "/purchase/indents"
        );

        return NextResponse.json({ success: true });
      }

      if (body.action === "UPLOAD_GRN") {
        if (existing.status !== "GOODS_PURCHASED") {
          return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
        }
        if (!body.grnUrl || !body.grnNumber || !body.grnMessage) {
          return NextResponse.json({ error: "grnUrl, grnNumber, and grnMessage are all required" }, { status: 400 });
        }

        const { name: hodName } = await getUserProfile(db, session.collegeId, session.uid);
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

      return NextResponse.json({ error: "action must be RESUBMIT or UPLOAD_GRN" }, { status: 400 });
    }

    // ── Purchase Dept: reject / return to HOD, forward to Finance, or mark goods purchased ──

    if (session.role === "PURCHASE_DEPT") {
      const { name: purchaseName } = await getUserProfile(db, session.collegeId, session.uid);

      if (body.action === "REJECT" || body.action === "RETURN") {
        if (existing.status !== "PENDING_PURCHASE_REVIEW") {
          return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
        }
        if (!body.remarks) {
          return NextResponse.json({ error: "remarks required" }, { status: 400 });
        }
        const nextStatus: "REJECTED_BY_PURCHASE" | "RETURNED_TO_HOD" = body.action === "REJECT" ? "REJECTED_BY_PURCHASE" : "RETURNED_TO_HOD";
        const historyEntry = {
          action: nextStatus,
          by: session.uid,
          byName: purchaseName,
          byRole: "PURCHASE_DEPT" as const,
          at: now,
          remarks: body.remarks,
        };

        await ref.update({
          status: nextStatus,
          history: [...(existing.history ?? []), historyEntry],
          updatedAt: now,
        });

        await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
          collegeId: session.collegeId,
          action: nextStatus === "REJECTED_BY_PURCHASE" ? "PURCHASE_CLEARANCE_REJECTED_BY_PURCHASE" : "PURCHASE_CLEARANCE_RETURNED_TO_HOD",
          performedBy: session.uid,
          performedByName: purchaseName,
          targetId: id,
          details: { department: existing.department, items: existing.items },
          timestamp: now,
        });

        await notify(
          db, session.collegeId, existing.hodUid,
          nextStatus === "REJECTED_BY_PURCHASE" ? "PURCHASE_CLEARANCE_REJECTED_BY_PURCHASE" : "PURCHASE_CLEARANCE_RETURNED_TO_HOD",
          nextStatus === "REJECTED_BY_PURCHASE" ? "Purchase Clearance Rejected" : "Purchase Clearance Returned",
          `Purchase Dept ${nextStatus === "REJECTED_BY_PURCHASE" ? "rejected" : "returned"} your purchase clearance request "${existing.items}". Remarks: ${body.remarks}`,
          "/hod/purchase-clearance"
        );

        return NextResponse.json({ success: true });
      }

      if (body.action === "SEND_TO_FINANCE") {
        if (existing.status !== "PENDING_PURCHASE_REVIEW" && existing.status !== "RETURNED_TO_PURCHASE") {
          return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
        }
        const quotations = Array.isArray(body.quotations) ? body.quotations : [];
        if (quotations.length < MIN_QUOTATIONS) {
          return NextResponse.json({ error: `At least ${MIN_QUOTATIONS} quotations are required` }, { status: 400 });
        }
        if (quotations.some((q) => !q.vendorName || !q.termsAndConditions || !(q.price > 0) || !q.expectedDeliveryDate)) {
          return NextResponse.json(
            { error: "Every quotation needs a vendor name, terms & conditions, price, and expected delivery date" },
            { status: 400 }
          );
        }
        if (!body.selectedQuotationId || !quotations.some((q) => q.id === body.selectedQuotationId)) {
          return NextResponse.json({ error: "Select one quotation to recommend to Finance" }, { status: 400 });
        }

        const historyEntry = {
          action: "PENDING_FINANCE_REVIEW" as const,
          by: session.uid,
          byName: purchaseName,
          byRole: "PURCHASE_DEPT" as const,
          at: now,
        };

        await ref.update({
          quotations,
          selectedQuotationId: body.selectedQuotationId,
          status: "PENDING_FINANCE_REVIEW",
          history: [...(existing.history ?? []), historyEntry],
          updatedAt: now,
        });

        await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
          collegeId: session.collegeId,
          action: "PURCHASE_CLEARANCE_SENT_TO_FINANCE",
          performedBy: session.uid,
          performedByName: purchaseName,
          targetId: id,
          details: { department: existing.department, items: existing.items },
          timestamp: now,
        });

        await notifyRole(
          db, session.collegeId, "FINANCE",
          "PURCHASE_CLEARANCE_SENT_TO_FINANCE", "Purchase Clearance Ready for Review",
          `${existing.items} (${existing.department}) was forwarded by ${purchaseName} with vendor quotations and is ready for Finance review.`,
          "/finance/purchase-clearance"
        );

        return NextResponse.json({ success: true });
      }

      if (body.action === "GOODS_PURCHASED") {
        if (existing.status !== "APPROVED") {
          return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
        }

        const historyEntry = {
          action: "GOODS_PURCHASED" as const,
          by: session.uid,
          byName: purchaseName,
          byRole: "PURCHASE_DEPT" as const,
          at: now,
        };

        await ref.update({
          status: "GOODS_PURCHASED",
          history: [...(existing.history ?? []), historyEntry],
          updatedAt: now,
        });

        await db.collection("colleges").doc(session.collegeId).collection("financeAuditLogs").add({
          collegeId: session.collegeId,
          action: "PURCHASE_CLEARANCE_GOODS_PURCHASED",
          performedBy: session.uid,
          performedByName: purchaseName,
          targetId: id,
          details: { department: existing.department },
          timestamp: now,
        });

        const notifMessage = `${purchaseName} purchased the goods for "${existing.items}" (${existing.department}).`;
        await notify(db, session.collegeId, existing.hodUid, "PURCHASE_CLEARANCE_GOODS_PURCHASED", "Goods Purchased — Upload GRN", `${notifMessage} Upload the GRN to confirm receipt.`, "/hod/purchase-clearance");
        await notifyRole(db, session.collegeId, "FINANCE", "PURCHASE_CLEARANCE_GOODS_PURCHASED", "Goods Purchased", notifMessage, "/finance/purchase-clearance");

        return NextResponse.json({ success: true });
      }

      return NextResponse.json({ error: "action must be REJECT, RETURN, SEND_TO_FINANCE, or GOODS_PURCHASED" }, { status: 400 });
    }

    // ── Finance: approve / reject / return ──────────────────────────────────

    if (existing.status !== "PENDING_FINANCE_REVIEW") {
      return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
    }
    if ((body.action === "REJECT" || body.action === "RETURN") && !body.remarks) {
      return NextResponse.json({ error: "remarks required" }, { status: 400 });
    }

    const { name: financeName } = await getUserProfile(db, session.collegeId, session.uid);
    const nextStatus: "APPROVED" | "REJECTED" | "RETURNED_TO_PURCHASE" | null =
      body.action === "APPROVE" ? "APPROVED"
      : body.action === "REJECT" ? "REJECTED"
      : body.action === "RETURN" ? "RETURNED_TO_PURCHASE"
      : null;

    if (!nextStatus) {
      return NextResponse.json({ error: "action must be APPROVE, REJECT, or RETURN" }, { status: 400 });
    }

    const historyEntry = {
      action: nextStatus,
      by: session.uid,
      byName: financeName,
      byRole: "FINANCE" as const,
      at: now,
      ...(body.remarks ? { remarks: body.remarks } : {}),
    };

    await ref.update({
      status: nextStatus,
      history: [...(existing.history ?? []), historyEntry],
      updatedAt: now,
    });

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: nextStatus === "APPROVED" ? "PURCHASE_CLEARANCE_FINANCE_APPROVED"
        : nextStatus === "REJECTED" ? "PURCHASE_CLEARANCE_FINANCE_REJECTED"
        : "PURCHASE_CLEARANCE_RETURNED_TO_PURCHASE",
      performedBy: session.uid,
      performedByName: financeName,
      targetId: id,
      details: { department: existing.department, items: existing.items },
      timestamp: now,
    });

    const notifType = nextStatus === "APPROVED" ? "PURCHASE_CLEARANCE_FINANCE_APPROVED" : nextStatus === "REJECTED" ? "PURCHASE_CLEARANCE_FINANCE_REJECTED" : "PURCHASE_CLEARANCE_RETURNED_TO_PURCHASE";
    const notifTitle = nextStatus === "APPROVED" ? "Purchase Clearance Approved" : nextStatus === "REJECTED" ? "Purchase Clearance Rejected" : "Purchase Clearance Returned";
    const notifVerb = nextStatus === "APPROVED" ? "approved" : nextStatus === "REJECTED" ? "rejected" : "returned";
    const notifMessage = `Finance ${notifVerb} the purchase clearance request "${existing.items}".${body.remarks ? " Remarks: " + body.remarks : ""}`;

    await notify(db, session.collegeId, existing.hodUid, notifType, notifTitle, notifMessage, "/hod/purchase-clearance");
    await notifyRole(db, session.collegeId, "PURCHASE_DEPT", notifType, notifTitle, notifMessage, "/purchase/indents");

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-purchase-clearance/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
