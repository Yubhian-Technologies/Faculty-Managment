export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Firestore } from "firebase-admin/firestore";
import type { IndentItem, IndentQuotation, IndentRequest } from "@/types";

async function getUserName(db: Firestore, collegeId: string, uid: string): Promise<string> {
  try {
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
    return (snap.data() as { name?: string } | undefined)?.name ?? "Unknown";
  } catch {
    return "Unknown";
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PURCHASE_DEPT", "FINANCE", "SUPER_ADMIN");
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
    const session = await requireCollegeMember("HOD", "PURCHASE_DEPT", "FINANCE", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as {
      action?: "REJECT" | "RETURN" | "SEND_TO_FINANCE" | "APPROVE";
      remarks?: string;
      items?: IndentItem[];
      quotations?: IndentQuotation[];
      selectedQuotationId?: string;
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
      const historyEntry = {
        action: "PENDING_PURCHASE_REVIEW" as const,
        byRole: "HOD" as const,
        byUid: session.uid,
        byName: hodName,
        at: now,
      };

      await ref.update({
        items,
        status: "PENDING_PURCHASE_REVIEW",
        history: [...(req.history ?? []), historyEntry],
        updatedAt: now,
      });

      await notifyRole(
        db, session.collegeId, "PURCHASE_DEPT",
        "INDENT_SUBMITTED", "Indent Resubmitted",
        `${hodName} resubmitted the indent "${req.title}" for ${req.department}.`,
        "/purchase/indents"
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

      return NextResponse.json({ error: "action must be REJECT, RETURN, or SEND_TO_FINANCE" }, { status: 400 });
    }

    // ── Finance approves (auto-creates FinancePayment) / rejects / returns ──

    if (session.role === "FINANCE") {
      if (req.status !== "PENDING_FINANCE_REVIEW") {
        return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
      }
      if ((body.action === "REJECT" || body.action === "RETURN") && !body.remarks) {
        return NextResponse.json({ error: "remarks required" }, { status: 400 });
      }

      const financeName = await getUserName(db, session.collegeId, session.uid);
      const nextStatus =
        body.action === "APPROVE" ? "APPROVED"
        : body.action === "REJECT" ? "REJECTED"
        : body.action === "RETURN" ? "RETURNED_TO_PURCHASE"
        : null;

      if (!nextStatus) {
        return NextResponse.json({ error: "action must be APPROVE, REJECT, or RETURN" }, { status: 400 });
      }

      if (nextStatus === "APPROVED") {
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

        if (nextStatus === "APPROVED") {
          const selected = (freshReq.quotations ?? []).find((q) => q.id === freshReq.selectedQuotationId);
          if (!selected) throw new Error("STALE_STATUS");

          financePaymentId = paymentRef.id;
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
        }

        tx.update(ref, {
          status: nextStatus,
          history: [...(freshReq.history ?? []), historyEntry],
          ...(financePaymentId ? { financePaymentId } : {}),
          updatedAt: now,
        });

        tx.set(auditRef, {
          collegeId: session.collegeId,
          action: nextStatus === "APPROVED" ? "INDENT_FINANCE_APPROVED" : "INDENT_FINANCE_REJECTED",
          performedBy: session.uid,
          performedByName: financeName,
          targetId: id,
          details: { title: req.title, department: req.department },
          timestamp: now,
        });
      });

      const notifType = nextStatus === "APPROVED" ? "INDENT_APPROVED" : nextStatus === "REJECTED" ? "INDENT_REJECTED" : "INDENT_RETURNED";
      const notifTitle = nextStatus === "APPROVED" ? "Indent Approved" : nextStatus === "REJECTED" ? "Indent Rejected" : "Indent Returned";
      const notifVerb = nextStatus === "APPROVED" ? "approved and disbursed" : nextStatus === "REJECTED" ? "rejected" : "returned";
      const notifMessage = `Finance ${notifVerb} the indent "${req.title}".${body.remarks ? " Remarks: " + body.remarks : ""}`;

      await notify(db, session.collegeId, req.hodUid, notifType, notifTitle, notifMessage, "/hod/indents");
      await notifyRole(db, session.collegeId, "PURCHASE_DEPT", notifType, notifTitle, notifMessage, "/purchase/indents");

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
