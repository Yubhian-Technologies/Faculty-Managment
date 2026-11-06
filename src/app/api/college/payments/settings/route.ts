export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { paymentSecretConfigured, sealSecret } from "@/lib/payments/secretBox";
import { paymentProxyConfigured } from "@/lib/payments/proxyPost";
import { loadCcavenue, paymentErrorResponse, PaymentError, paymentRefs, requirePaymentsManager, settingsView } from "@/lib/payments/server";
import type { CcavenueSettings } from "@/types";

// A college's CCAvenue account (?collegeId): Accounts (its location) / Super Admin.
// GET never returns the Working Key; PUT { enabled, env, merchantId, accessCode, workingKey? } -
// a blank workingKey keeps the saved one. The key is stored encrypted (PAYMENT_CONFIG_SECRET).

export async function GET(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requirePaymentsManager(db, request);
    return NextResponse.json({ settings: settingsView(await loadCcavenue(db, session.collegeId)), secretConfigured: paymentSecretConfigured(), proxyConfigured: paymentProxyConfigured() });
  } catch (err) {
    return paymentErrorResponse(err, "[college/payments/settings GET]");
  }
}

export async function PUT(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requirePaymentsManager(db, request);
    const body = (await readJsonBody(request)) as { enabled?: unknown; env?: unknown; merchantId?: unknown; accessCode?: unknown; workingKey?: unknown };
    const merchantId = String(body.merchantId ?? "").trim();
    const accessCode = String(body.accessCode ?? "").trim();
    const workingKey = String(body.workingKey ?? "").trim();
    const env = body.env === "LIVE" ? "LIVE" : "TEST";
    const enabled = body.enabled === true;
    if (merchantId && !/^\d{1,20}$/.test(merchantId)) throw new PaymentError("The Merchant ID is a number");
    if (accessCode && !/^[A-Za-z0-9]{6,40}$/.test(accessCode)) throw new PaymentError("The Access Code looks wrong - copy it again from the CCAvenue dashboard");
    if (workingKey && !/^[A-Za-z0-9]{16,64}$/.test(workingKey)) throw new PaymentError("The Working Key looks wrong - copy it again from the CCAvenue dashboard");
    if (workingKey && !paymentSecretConfigured()) throw new PaymentError("Online payment isn't set up on the server yet (PAYMENT_CONFIG_SECRET) - ask the administrator", 503);

    const cur = await loadCcavenue(db, session.collegeId);
    const workingKeyEnc = workingKey ? sealSecret(workingKey) : cur?.workingKeyEnc;
    if (enabled && (!merchantId || !accessCode || !workingKeyEnc)) throw new PaymentError("Enter the Merchant ID, Access Code and Working Key before turning online payment on");
    const actor = session.email;
    const next: CcavenueSettings = {
      enabled, env, merchantId, accessCode, ...(workingKeyEnc ? { workingKeyEnc } : {}),
      updatedAt: new Date().toISOString(), updatedByName: actor,
    };
    await paymentRefs(db, session.collegeId).settings.set(next);
    await writeAuditLogSafe(db, session.collegeId, {
      action: "PAYMENT_SETTINGS_UPDATED", performedBy: session.uid, performedByName: actor, targetId: "ccavenue",
      details: { enabled, env, merchantId, workingKeyChanged: !!workingKey },
    });
    return NextResponse.json({ settings: settingsView(next), secretConfigured: paymentSecretConfigured(), proxyConfigured: paymentProxyConfigured() });
  } catch (err) {
    return paymentErrorResponse(err, "[college/payments/settings PUT]");
  }
}
