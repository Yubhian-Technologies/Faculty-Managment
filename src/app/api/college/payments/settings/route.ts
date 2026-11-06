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
    const body = (await readJsonBody(request)) as { enabled?: unknown; env?: unknown; merchantId?: unknown; accessCode?: unknown; workingKey?: unknown; apiKeys?: unknown };
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
    // Extra API keys per whitelisted proxy IP: { label, accessCode, workingKey? } - a blank key keeps the saved one
    // of the same access code. Left out = keep them as they are.
    let apiKeys = cur?.apiKeys ?? [];
    if (Array.isArray(body.apiKeys)) {
      if (body.apiKeys.length > 5) throw new PaymentError("At most 5 extra API keys");
      apiKeys = (body.apiKeys as { label?: unknown; accessCode?: unknown; workingKey?: unknown }[]).map((k, i) => {
        const label = String(k?.label ?? "").trim().slice(0, 60) || `Key ${i + 1}`;
        const code = String(k?.accessCode ?? "").trim();
        const key = String(k?.workingKey ?? "").trim();
        if (!/^[A-Za-z0-9]{6,40}$/.test(code)) throw new PaymentError(`${label}: the Access Code looks wrong`);
        if (key && !/^[A-Za-z0-9]{16,64}$/.test(key)) throw new PaymentError(`${label}: the Working Key looks wrong`);
        if (key && !paymentSecretConfigured()) throw new PaymentError("Online payment isn't set up on the server yet (PAYMENT_CONFIG_SECRET) - ask the administrator", 503);
        const enc = key ? sealSecret(key) : cur?.apiKeys?.find((x) => x.accessCode === code)?.workingKeyEnc;
        if (!enc) throw new PaymentError(`${label}: enter its Working Key`);
        return { label, accessCode: code, workingKeyEnc: enc };
      });
    }
    if (enabled && (!merchantId || !accessCode || !workingKeyEnc)) throw new PaymentError("Enter the Merchant ID, Access Code and Working Key before turning online payment on");
    const actor = session.email;
    const next: CcavenueSettings = {
      enabled, env, merchantId, accessCode, ...(workingKeyEnc ? { workingKeyEnc } : {}), apiKeys,
      updatedAt: new Date().toISOString(), updatedByName: actor,
    };
    await paymentRefs(db, session.collegeId).settings.set(next);
    await writeAuditLogSafe(db, session.collegeId, {
      action: "PAYMENT_SETTINGS_UPDATED", performedBy: session.uid, performedByName: actor, targetId: "ccavenue",
      details: { enabled, env, merchantId, workingKeyChanged: !!workingKey, apiKeys: apiKeys.map((k) => k.label) },
    });
    return NextResponse.json({ settings: settingsView(next), secretConfigured: paymentSecretConfigured(), proxyConfigured: paymentProxyConfigured() });
  } catch (err) {
    return paymentErrorResponse(err, "[college/payments/settings PUT]");
  }
}
