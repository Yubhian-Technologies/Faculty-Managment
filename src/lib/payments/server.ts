import type { Firestore } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { badBodyResponse } from "@/lib/http/readJsonBody";
import { openSecret } from "./secretBox";
import type { CcavenueSettings, CcavenueSettingsView, Payment } from "@/types";

// Server side of online payments: where things live, who may manage them, and the college's
// CCAvenue account. Accounts (the location login) and Super Admin manage a college's payments -
// the college is passed as ?collegeId and must belong to the Accounts login's location.

export const PAYMENT_MANAGER_ROLES = ["ACCOUNTS", "SUPER_ADMIN"] as const;

export const paymentRefs = (db: Firestore, collegeId: string) => {
  const college = db.collection("colleges").doc(collegeId);
  return { college, payments: college.collection("payments"), settings: college.collection("paymentSettings").doc("ccavenue") };
};

export class PaymentError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 503 = 400) { super(message); }
}

/** Accounts / Super Admin, for the college named by ?collegeId (or their own). */
export async function requirePaymentsManager(db: Firestore, request: Request) {
  const session = await requireRole(...PAYMENT_MANAGER_ROLES);
  const collegeId = new URL(request.url).searchParams.get("collegeId") || session.collegeId || "";
  if (!collegeId) throw new PaymentError("Pick a college", 400);
  if (session.role === "ACCOUNTS") {
    const snap = await db.collection("colleges").doc(collegeId).get();
    const loc = (snap.data() as { locationId?: string } | undefined)?.locationId;
    const ok = snap.exists && (collegeId === session.collegeId || (!!session.locationId && loc === session.locationId));
    if (!ok) throw new PaymentError("This college isn't in your location", 403);
  }
  return { ...session, collegeId };
}

export async function loadCcavenue(db: Firestore, collegeId: string): Promise<CcavenueSettings | null> {
  const snap = await paymentRefs(db, collegeId).settings.get();
  return snap.exists ? (snap.data() as CcavenueSettings) : null;
}

export function settingsView(s: CcavenueSettings | null): CcavenueSettingsView {
  return {
    enabled: !!s?.enabled, env: s?.env ?? "TEST", merchantId: s?.merchantId ?? "", accessCode: s?.accessCode ?? "",
    hasWorkingKey: !!s?.workingKeyEnc, updatedAt: s?.updatedAt, updatedByName: s?.updatedByName,
    apiKeys: (s?.apiKeys ?? []).map((k) => ({ label: k.label, accessCode: k.accessCode, hasWorkingKey: !!k.workingKeyEnc })),
  };
}

/** The college's account ready to use (with its Working Key), or null when online payment is off / incomplete. */
export async function activeCcavenue(db: Firestore, collegeId: string): Promise<(CcavenueSettings & { workingKey: string; fallbacks: { accessCode: string; workingKey: string }[] }) | null> {
  const s = await loadCcavenue(db, collegeId);
  if (!s?.enabled || !s.merchantId || !s.accessCode || !s.workingKeyEnc) return null;
  try {
    const fallbacks = (s.apiKeys ?? []).flatMap((k) => { try { return [{ accessCode: k.accessCode, workingKey: openSecret(k.workingKeyEnc) }]; } catch { return []; } });
    return { ...s, workingKey: openSecret(s.workingKeyEnc), fallbacks };
  } catch { return null; }
}

/** The public base URL CCAvenue sends the student back to (APP_URL, else the request's own origin). */
export function appBaseUrl(request: Request): string {
  const env = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  return env || new URL(request.url).origin;
}

export const paymentOf = (id: string, data: unknown) => ({ ...(data as Omit<Payment, "id">), id }) as Payment;

/** A payment as a browser sees it (the raw gateway fields stay on the server). */
export function paymentView(p: Payment) {
  const { gatewayResponse: _raw, ...rest } = p;
  void _raw;
  return rest;
}

export function paymentErrorResponse(err: unknown, label: string): NextResponse {
  const bad = badBodyResponse(err);
  if (bad) return bad;
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (err instanceof PaymentError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(label, err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
