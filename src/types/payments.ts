// Online payments through CCAvenue (one merchant account per college).
//
//   colleges/{c}/paymentSettings/ccavenue   the college's CCAvenue account (the Working Key encrypted at rest)
//   colleges/{c}/payments/{orderId}         one per checkout attempt, INITIATED -> SUCCESS | FAILED | ABORTED,
//                                           then REFUNDED / PARTIALLY_REFUNDED when Accounts records a refund
//
// Managed by the location Accounts login (and Super Admin). The amount always comes from the server record.

export type PaymentStatus = "INITIATED" | "SUCCESS" | "FAILED" | "ABORTED" | "REFUNDED" | "PARTIALLY_REFUNDED";

export type PaymentPurpose = { kind: "CERTIFICATE"; requestId: string; label: string };

export interface PaymentRefund {
  at: string;
  /** CCAVENUE_API = refunded from FMS through CCAvenue's Refund API; RECORDED = done in their dashboard, recorded here. */
  via?: "CCAVENUE_API" | "RECORDED";
  amount: number;
  /** CCAvenue's refund reference, as shown in their dashboard. */
  reference: string;
  reason: string;
  byUid: string;
  byName: string;
}

export interface Payment {
  id: string; // = order id sent to CCAvenue
  collegeId: string;
  purpose: PaymentPurpose;
  amount: number;
  currency: "INR";
  status: PaymentStatus;
  studentId: string;
  studentUid: string;
  studentName: string;
  studentRollNumber: string;
  gateway: "CCAVENUE";
  /** CCAvenue's answer (when it came back). */
  trackingId?: string;
  bankRefNo?: string;
  paymentMode?: string;
  cardName?: string;
  gatewayStatus?: string;
  statusMessage?: string;
  failureMessage?: string;
  /** The fields CCAvenue returned, as received (no card numbers are ever returned). */
  gatewayResponse?: Record<string, string>;
  settledAt?: string;
  /** Last time CCAvenue's Order Status API was asked (through the static-IP proxy). */
  lastCheckedAt?: string;
  statusCheckCount?: number;
  /** A refund through CCAvenue's Refund API in progress (blocks a second one until it answers). */
  refundPending?: { ref: string; amount: number; at: string; byName: string } | null;
  /** Paid twice (the fee was already paid by another order) - Accounts should refund this one. */
  needsRefund?: boolean;
  refunds?: PaymentRefund[];
  refundedAmount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CcavenueSettings {
  enabled: boolean;
  /** TEST = test.ccavenue.com, LIVE = secure.ccavenue.com */
  env: "TEST" | "LIVE";
  merchantId: string;
  accessCode: string;
  /** The Working Key, encrypted with PAYMENT_CONFIG_SECRET - never returned to any browser. */
  workingKeyEnc?: string;
  /**
   * Extra API keys CCAvenue issued per whitelisted static IP (one Access Code + Working Key per proxy IP). The
   * Order Status / Refund APIs try the website pair first, then these, until CCAvenue accepts one.
   */
  apiKeys?: { label: string; accessCode: string; workingKeyEnc: string }[];
  updatedAt?: string;
  updatedByName?: string;
}

/** What the settings screen sees (no key). */
export type CcavenueSettingsView = Omit<CcavenueSettings, "workingKeyEnc" | "apiKeys"> & { hasWorkingKey: boolean; apiKeys: { label: string; accessCode: string; hasWorkingKey: boolean }[] };
