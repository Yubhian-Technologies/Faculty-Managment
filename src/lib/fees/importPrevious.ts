// Accounts > Fees > Import Previous Fees: a college's fees already worked out in its previous accounting system.
//  - Debit notes (one fee line per student): each student's fee for the year, exactly as charged - amount, category
//    (A / B / Spot), FR / NFR and the government's part. Used when fees differ by branch or student and no structure
//    fits (VWU 2026-27). The account is marked `source: "IMPORT"`, so Raise Fees never overwrites it.
//  - Receipts (payments already made): recorded against those fees with their own voucher numbers, date, bank and
//    mode, so balances and reports start from the real position. Re-uploading skips receipts already imported.
// Pure checks here; reading / writing is lib/fees/importServer.ts.

import type { FeeCategory, FeeFunding, FeePaymentMode, FeeStructureInstalment } from "@/types/fees";

export interface DebitNoteRow {
  row: number; roll: string; admissionType: string; category: string; payment: string;
  total: string; tuition: string; scholarship: string; feeType: string; voucherNo: string; voucherDate: string;
}
export interface ReceiptRow {
  row: number; roll: string; amount: string; paidOn: string; voucherNo: string; mode: string; bank: string; reference: string; feeType: string;
}

/** Imported fees have no due dates until the college sets them: one instalment for the whole fee, date blank. */
export const IMPORTED_PLAN: FeeStructureInstalment[] = [{ no: 1, label: "Full Fee", dueDate: "", percent: 100 }];

const money = (s: string): number | null => {
  const t = String(s ?? "").replace(/[₹,\s]/g, "").replace(/^Rs\.?/i, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 0 ? n : NaN;
};

/** "14/10/2026", "2026-10-14" or "14-10-2026" -> "2026-10-14"; null when not a real date. */
export function isoDate(raw: string): string | null {
  const t = String(raw ?? "").trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (r) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t))) { d = +r[1]; m = +r[2]; y = +r[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export const normRoll = (s: string) => String(s ?? "").trim().toUpperCase();

/** A debit note's category, FR / NFR and amounts - or why it can't be taken. */
export function checkDebitNote(r: DebitNoteRow):
  { ok: true; category: FeeCategory; funding: FeeFunding; total: number; govt: number; student: number } | { ok: false; error: string } {
  const type = String(r.admissionType ?? "").trim().toUpperCase();
  const cat = String(r.category ?? "").trim().toUpperCase().replace(/^CATEGORY[\s-]*/, "");
  const category: FeeCategory | null = /SPOT/.test(type) || cat === "SPOT" ? "SPOT" : cat === "A" ? "A" : cat === "B" ? "B" : null;
  if (!category) return { ok: false, error: `Category "${r.category || "blank"}" is not A or B.` };
  const pay = String(r.payment ?? "").trim().toUpperCase();
  // VWU writes NFR, VIT writes NF; "Non FR" / "Non-FR" read the same.
  const funding: FeeFunding | null = pay === "FR" ? "FR" : ["NFR", "NF", "NON FR", "NON-FR", "NONFR", ""].includes(pay) ? "NFR" : null;
  if (!funding) return { ok: false, error: `Payment "${r.payment}" is not FR or NFR.` };
  if (funding === "FR" && category !== "A") return { ok: false, error: `Only a Category A student can be FR (this one is ${category === "SPOT" ? "Spot" : "B"}).` };
  const total = money(r.total), student = money(r.tuition), govt = money(r.scholarship);
  if (total === null || Number.isNaN(total) || total <= 0) return { ok: false, error: "Enter the fee in whole rupees." };
  if (Number.isNaN(student) || Number.isNaN(govt)) return { ok: false, error: "The student's and the government's parts must be whole rupees." };
  const s = student ?? (funding === "FR" ? 0 : total), g = govt ?? (funding === "FR" ? total : 0);
  if (s + g !== total) return { ok: false, error: `The student's part (${s}) and the government's (${g}) don't add up to the fee (${total}).` };
  // FR here means the government pays the whole fee line; a part-FR split isn't supported.
  if (funding === "FR" && g !== total) return { ok: false, error: "An FR student's fee must be paid in full by the government (student part 0)." };
  if (funding === "NFR" && g !== 0) return { ok: false, error: "An NFR student can't have a government part." };
  return { ok: true, category, funding, total, govt: g, student: s };
}

const MODE_WORDS: [RegExp, FeePaymentMode][] = [
  [/UPI|GPAY|PHONEPE|PAYTM/i, "UPI"],
  [/CASH/i, "CASH"],
  [/\bDD\b|DEMAND/i, "DD"],
  [/CHEQUE|CHQ|CHECK/i, "CHEQUE"],
  [/ONLINE|TRANSFER|NEFT|RTGS|IMPS|BANK|CHALLAN/i, "BANK"],
];

/** A receipt row's amount, date and mode - or why it can't be taken. */
export function checkReceipt(r: ReceiptRow, today: string):
  { ok: true; amount: number; paidOn: string; mode: FeePaymentMode; voucherNo: string } | { ok: false; error: string } {
  const amount = money(r.amount);
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { ok: false, error: "Enter the amount in whole rupees." };
  const paidOn = isoDate(r.paidOn);
  if (!paidOn) return { ok: false, error: `"${r.paidOn || "blank"}" is not a date (DD/MM/YYYY).` };
  if (paidOn > today) return { ok: false, error: "The date paid can't be in the future." };
  const voucherNo = String(r.voucherNo ?? "").trim();
  if (!voucherNo) return { ok: false, error: "Enter the receipt (voucher) number." };
  if (voucherNo.length > 60) return { ok: false, error: "The receipt number is too long." };
  const mode = MODE_WORDS.find(([re]) => re.test(r.mode ?? ""))?.[1];
  if (!mode) return { ok: false, error: `Payment mode "${r.mode || "blank"}" is not known (cash, UPI, bank transfer, DD, cheque).` };
  return { ok: true, amount, paidOn, mode, voucherNo };
}

/** The receipt's document id - the same voucher number always lands on the same doc, so a re-upload skips it. */
export const importedReceiptId = (voucherNo: string) => `imp_${voucherNo.trim().toUpperCase().replace(/[^A-Z0-9-]+/g, "_").slice(0, 120)}`;
