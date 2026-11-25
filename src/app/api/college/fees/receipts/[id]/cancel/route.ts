export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { paymentErrorResponse } from "@/lib/payments/server";
import { requireFeesManager } from "@/lib/fees/http";
import { cancelReceipt } from "@/lib/fees/server";

// Accounts > Fees > a receipt > Cancel (?collegeId): POST { reason } - a counter receipt entered by mistake / a bounced
// cheque. The receipt stays (marked cancelled); its amount comes off what the student paid.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const db = getAdminDb();
    const session = await requireFeesManager(db, request);
    const { id } = await params;
    const body = (await readJsonBody(request)) as { reason?: unknown };
    const { receipt, account } = await cancelReceipt(db, session.collegeId, id, body.reason, session.byName);
    await writeAuditLogSafe(db, session.collegeId, { action: "FEE_RECEIPT_CANCELLED", performedBy: session.uid, performedByName: session.byName, targetId: id, details: { receiptNo: receipt.receiptNo, rollNumber: receipt.rollNumber, amount: receipt.amount, reason: receipt.cancelled?.reason } });
    return NextResponse.json({ receipt, account });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/receipts/[id]/cancel POST]");
  }
}
