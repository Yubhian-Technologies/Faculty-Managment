export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Firestore } from "firebase-admin/firestore";
import type { IndentItem, IndentQuotation, IndentRequest } from "@/types";
import { indentItemsTotal } from "@/types";
import { notify, notifyRole } from "@/lib/notify";

async function getUserName(db: Firestore, collegeId: string, uid: string): Promise<string> {
  try {
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
    return (snap.data() as { name?: string } | undefined)?.name ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeContext(request, "HOD", "PURCHASE_DEPT", "FINANCE", "SUPER_ADMIN");
    const { id } = await params;

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("indentRequests").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const req = { id: snap.id, ...snap.data() } as IndentRequest;
    if (session.role === "HOD" && req.hodUid !== session.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ request: req });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/indent-requests/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeContext(request, "HOD", "PURCHASE_DEPT", "FINANCE", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as {
      action?: "REJECT" | "RETURN" | "SEND_TO_FINANCE" | "APPROVE" | "UPLOAD_RECEIPT";
      remarks?: string;
      items?: IndentItem[];
      quotations?: IndentQuotation[];
      selectedQuotationId?: string;
      receiptUrl?: string;
      receiptFileName?: string;
      receiptAmount?: number;
    };

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("indentRequests").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const req = { id: snap.id, ...snap.data() } as IndentRequest;
    const now = new Date();

    // ── HOD edits and resubmits a returned indent ──────────────────────────

    if (session.role === "HOD") {
      if (req.hodUid !== session.uid) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (req.status !== "RETURNED_TO_HOD") {
        return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
      }
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0 || items.some((i) => !i.description || !(i.quantity > 0) || i.estimatedUnitPrice < 0)) {
        return NextResponse.json(
          { error: "Every item needs a description, a quantity greater than 0, and a non-negative estimated price" },
          { status: 400 }
        );
      }
      const hodName = await getUserName(db, session.collegeId, session.uid);
      const isGoods = req.requestType !== "NON_GOODS";
      const nextStatus = isGoods ? "PENDING_PURCHASE_REVIEW" : "PENDING_FINANCE_REVIEW";
      const historyEntry = {
        action: nextStatus,
        byRole: "HOD" as const,
        byUid: session.uid,
        byName: hodName,
        at: now,
      };

      await ref.update({
        items,
        status: nextStatus,
        history: [...(req.history ?? []), historyEntry],
        updatedAt: now,
      });

      await notifyRole(
        db, session.collegeId, isGoods ? "PURCHASE_DEPT" : "FINANCE",
        "INDENT_SUBMITTED", "Indent Resubmitted",
        `${hodName} resubmitted the indent "${req.title}" for ${req.department}.`,
        isGoods ? "/purchase/indents" : "/finance/indent-approvals"
      );

      return NextResponse.json({ ok: true });
    }

    // ── Purchase Dept: reject / return to HOD, or forward to Finance ───────

    if (session.role === "PURCHASE_DEPT") {
      const purchaseName = await getUserName(db, session.collegeId, session.uid);

      if (body.action === "REJECT" || body.action === "RETURN") {
        if (req.status !== "PENDING_PURCHASE_REVIEW") {
          return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
        }
        if (!body.remarks) {
          return NextResponse.json({ error: "remarks required" }, { status: 400 });
        }
        const nextStatus = body.action === "REJECT" ? "REJECTED_BY_PURCHASE" : "RETURNED_TO_HOD";
        const historyEntry = {
          action: nextStatus,
          byRole: "PURCHASE_DEPT" as const,
          byUid: session.uid,
          byName: purchaseName,
          at: now,
          remarks: body.remarks,
        };

        await ref.update({
          status: nextStatus,
          history: [...(req.history ?? []), historyEntry],
          updatedAt: now,
        });

        await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
          collegeId: session.collegeId,
          action: nextStatus === "REJECTED_BY_PURCHASE" ? "INDENT_REJECTED_BY_PURCHASE" : "INDENT_RETURNED_TO_HOD",
          performedBy: session.uid,
          performedByName: purchaseName,
          targetId: id,
          details: { title: req.title, department: req.department },
          timestamp: now,
        });

        await notify(
          db, session.collegeId, req.hodUid,
          nextStatus === "REJECTED_BY_PURCHASE" ? "INDENT_REJECTED" : "INDENT_RETURNED",
          nextStatus === "REJECTED_BY_PURCHASE" ? "Indent Rejected" : "Indent Returned",
          `Purchase Dept ${nextStatus === "REJECTED_BY_PURCHASE" ? "rejected" : "returned"} your indent "${req.title}". Remarks: ${body.remarks}`,
          "/hod/indents"
        );

        return NextResponse.json({ ok: true });
      }

      if (body.action === "SEND_TO_FINANCE") {
        if (req.status !== "PENDING_PURCHASE_REVIEW" && req.status !== "RETURNED_TO_PURCHASE") {
          return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
        }
        const quotations = Array.isArray(body.quotations) ? body.quotations : [];
        if (quotations.length < 3) {
          return NextResponse.json({ error: "At least 3 quotations are required" }, { status: 400 });
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
          byRole: "PURCHASE_DEPT" as const,
          byUid: session.uid,
          byName: purchaseName,
          at: now,
        };

        await ref.update({
          quotations,
          selectedQuotationId: body.selectedQuotationId,
          status: "PENDING_FINANCE_REVIEW",
          history: [...(req.history ?? []), historyEntry],
          updatedAt: now,
        });

        await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
          collegeId: session.collegeId,
          action: "INDENT_SENT_TO_FINANCE",
          performedBy: session.uid,
          performedByName: purchaseName,
          targetId: id,
          details: { title: req.title, department: req.department },
          timestamp: now,
        });

        await notifyRole(
          db, session.collegeId, "FINANCE",
          "INDENT_SENT_TO_FINANCE", "Indent Ready for Review",
          `${req.title} (${req.department}) was forwarded by ${purchaseName} with vendor quotations and is ready for Finance review.`,
          "/finance/indent-approvals"
        );

        return NextResponse.json({ ok: true });
      }

      if (body.action === "UPLOAD_RECEIPT") {
        if (req.status !== "APPROVED") {
          return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
        }
        if (!body.receiptUrl) {
          return NextResponse.json({ error: "receiptUrl required" }, { status: 400 });
        }

        const selected = (req.quotations ?? []).find((q) => q.id === req.selectedQuotationId);
        const amount = body.receiptAmount ?? selected?.price ?? 0;

        const historyEntry = {
          action: "COMPLETED" as const,
          byRole: "PURCHASE_DEPT" as const,
          byUid: session.uid,
          byName: purchaseName,
          at: now,
        };

        await ref.update({
          status: "COMPLETED",
          receiptUrl: body.receiptUrl,
          receiptFileName: body.receiptFileName ?? null,
          receiptAmount: amount,
          receiptUploadedBy: session.uid,
          receiptUploadedByName: purchaseName,
          receiptUploadedAt: now,
          history: [...(req.history ?? []), historyEntry],
          updatedAt: now,
        });

        await db.collection("colleges").doc(session.collegeId).collection("financeReceipts").add({
          collegeId: session.collegeId,
          relatedType: "INDENT",
          relatedId: id,
          amount,
          description: req.title,
          fileUrl: body.receiptUrl,
          verified: false,
          createdBy: session.uid,
          createdByName: purchaseName,
          createdAt: now,
          updatedAt: now,
        });

        await db.collection("colleges").doc(session.collegeId).collection("financeAuditLogs").add({
          collegeId: session.collegeId,
          action: "RECEIPT_RECORDED",
          performedBy: session.uid,
          performedByName: purchaseName,
          targetId: id,
          details: { relatedType: "INDENT", relatedId: id, amount },
          timestamp: now,
        });

        await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
          collegeId: session.collegeId,
          action: "INDENT_RECEIPT_UPLOADED",
          performedBy: session.uid,
          performedByName: purchaseName,
          targetId: id,
          details: { title: req.title, department: req.department, amount },
          timestamp: now,
        });

        const notifMessage = `${purchaseName} uploaded the purchase receipt for "${req.title}" (${req.department}).`;
        await notify(db, session.collegeId, req.hodUid, "INDENT_RECEIPT_UPLOADED", "Indent Completed", notifMessage, "/hod/indents");
        await notifyRole(db, session.collegeId, "FINANCE", "INDENT_RECEIPT_UPLOADED", "Purchase Receipt Uploaded", notifMessage, "/finance/receipts");

        return NextResponse.json({ ok: true });
      }

      return NextResponse.json({ error: "action must be REJECT, RETURN, SEND_TO_FINANCE, or UPLOAD_RECEIPT" }, { status: 400 });
    }

    // ── Finance approves (auto-creates FinancePayment) / rejects / returns ──

    if (session.role === "FINANCE") {
      if (req.status !== "PENDING_FINANCE_REVIEW") {
        return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
      }
      if ((body.action === "REJECT" || body.action === "RETURN") && !body.remarks) {
        return NextResponse.json({ error: "remarks required" }, { status: 400 });
      }

      // GOODS indents were sourced by Purchase Dept and return there / carry a
      // vendor quotation. NON_GOODS indents came straight from the HOD (no
      // Purchase Dept involvement), so approval completes the indent outright
      // and returns go straight back to the HOD, not Purchase Dept.
      const isGoods = req.requestType !== "NON_GOODS";
      const isApproving = body.action === "APPROVE";

      const financeName = await getUserName(db, session.collegeId, session.uid);
      const nextStatus =
        isApproving ? (isGoods ? "APPROVED" : "COMPLETED")
        : body.action === "REJECT" ? "REJECTED"
        : body.action === "RETURN" ? (isGoods ? "RETURNED_TO_PURCHASE" : "RETURNED_TO_HOD")
        : null;

      if (!nextStatus) {
        return NextResponse.json({ error: "action must be APPROVE, REJECT, or RETURN" }, { status: 400 });
      }

      if (isApproving && isGoods) {
        const selected = (req.quotations ?? []).find((q) => q.id === req.selectedQuotationId);
        if (!selected) {
          return NextResponse.json({ error: "No selected quotation found on this indent" }, { status: 400 });
        }
      }

      const historyEntry = {
        action: nextStatus,
        byRole: "FINANCE" as const,
        byUid: session.uid,
        byName: financeName,
        at: now,
        ...(body.remarks ? { remarks: body.remarks } : {}),
      };

      const paymentRef = db.collection("colleges").doc(session.collegeId).collection("financePayments").doc();
      const financeAuditRef = db.collection("colleges").doc(session.collegeId).collection("financeAuditLogs").doc();
      const auditRef = db.collection("colleges").doc(session.collegeId).collection("auditLogs").doc();
      let financePaymentId: string | undefined;

      await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(ref);
        const freshReq = freshSnap.data() as IndentRequest | undefined;
        if (!freshSnap.exists || freshReq?.status !== "PENDING_FINANCE_REVIEW") {
          throw new Error("STALE_STATUS");
        }

        if (isApproving) {
          financePaymentId = paymentRef.id;

          if (isGoods) {
            const selected = (freshReq.quotations ?? []).find((q) => q.id === freshReq.selectedQuotationId);
            if (!selected) throw new Error("STALE_STATUS");

            tx.set(paymentRef, {
              collegeId: session.collegeId,
              type: "VENDOR",
              payeeName: selected.vendorName,
              amount: selected.price,
              purpose: req.title,
              relatedIndentId: id,
              status: "PENDING",
              createdBy: session.uid,
              createdByName: financeName,
              createdAt: now,
              updatedAt: now,
            });

            tx.set(financeAuditRef, {
              collegeId: session.collegeId,
              action: "PAYMENT_CREATED",
              performedBy: session.uid,
              performedByName: financeName,
              targetId: paymentRef.id,
              details: { department: req.department, relatedIndentId: id, vendorName: selected.vendorName, amount: selected.price },
              timestamp: now,
            });
          } else {
            const amount = indentItemsTotal(freshReq.items);
            tx.set(paymentRef, {
              collegeId: session.collegeId,
              type: "STAFF_REIMBURSEMENT",
              payeeName: freshReq.hodName,
              amount,
              purpose: req.title,
              relatedIndentId: id,
              status: "PENDING",
              createdBy: session.uid,
              createdByName: financeName,
              createdAt: now,
              updatedAt: now,
            });

            tx.set(financeAuditRef, {
              collegeId: session.collegeId,
              action: "PAYMENT_CREATED",
              performedBy: session.uid,
              performedByName: financeName,
              targetId: paymentRef.id,
              details: { department: req.department, relatedIndentId: id, amount },
              timestamp: now,
            });
          }
        }

        tx.update(ref, {
          status: nextStatus,
          history: [...(freshReq.history ?? []), historyEntry],
          ...(financePaymentId ? { financePaymentId } : {}),
          updatedAt: now,
        });

        tx.set(auditRef, {
          collegeId: session.collegeId,
          action: isApproving ? "INDENT_FINANCE_APPROVED" : "INDENT_FINANCE_REJECTED",
          performedBy: session.uid,
          performedByName: financeName,
          targetId: id,
          details: { title: req.title, department: req.department },
          timestamp: now,
        });
      });

      const notifType = isApproving ? "INDENT_APPROVED" : nextStatus === "REJECTED" ? "INDENT_REJECTED" : "INDENT_RETURNED";
      const notifTitle = isApproving ? "Indent Approved" : nextStatus === "REJECTED" ? "Indent Rejected" : "Indent Returned";
      const notifVerb = isApproving ? "approved and disbursed" : nextStatus === "REJECTED" ? "rejected" : "returned";
      const notifMessage = `Finance ${notifVerb} the indent "${req.title}".${body.remarks ? " Remarks: " + body.remarks : ""}`;

      await notify(db, session.collegeId, req.hodUid, notifType, notifTitle, notifMessage, "/hod/indents");
      if (isGoods) {
        await notifyRole(db, session.collegeId, "PURCHASE_DEPT", notifType, notifTitle, notifMessage, "/purchase/indents");
      }

      return NextResponse.json({ ok: true, financePaymentId });
    }

    return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof Error && err.message === "STALE_STATUS") {
      return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
    }
    console.error("[college/indent-requests/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
