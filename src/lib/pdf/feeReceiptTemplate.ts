import { logoSrc } from "@/lib/pdf/logo";
import type { Payment } from "@/types";

// Print-ready fee receipt for an online payment, laid out like the college's own printed fee receipts:
// logo top-left, college name + place centred, "<fee> Receipt", the copy label (STUDENT), No / Dated / Receipt
// mode on the left and the transaction details on the right, the amount in words, who paid it (name, Regd. No,
// year, branch), towards what, the breakdown and total, a narration, and "For <college> / Authorised Signatory".

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function belowHundred(n: number): string { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`; }
function belowThousand(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? belowHundred(r) : ""].filter(Boolean).join(" ");
}
/** Whole rupees in the Indian system: 52500 -> "Fifty Two Thousand Five Hundred". */
export function rupeesInWords(amount: number): string {
  const rupees = Math.floor(Math.round(amount * 100) / 100);
  const paise = Math.round(amount * 100) % 100;
  const parts: string[] = [];
  let n = rupees;
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${rupeesInWords(crore).replace(/^Indian Rupees | Only$/g, "")} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  const words = parts.join(" ") || "Zero";
  return `Indian Rupees ${words}${paise ? ` and ${belowHundred(paise)} Paise` : ""} Only`;
}

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateText = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "");

export interface FeeReceiptData {
  payment: Pick<Payment, "id" | "receiptNo" | "amount" | "chargedAmount" | "status" | "purpose" | "studentName" | "studentRollNumber" | "studentYear" | "studentDepartment" | "academicYear" | "trackingId" | "bankRefNo" | "paymentMode" | "cardName" | "settledAt" | "createdAt" | "refundedAmount">;
  college: { name: string; place?: string; logoUrl?: string };
  copy?: string;
}

export function getFeeReceiptHTML(d: FeeReceiptData): string {
  const p = d.payment;
  const paidOn = dateText(p.settledAt ?? p.createdAt);
  const mode = ["Online - CCAvenue", p.paymentMode, p.cardName].filter(Boolean).join(" / ");
  const gateway = p.chargedAmount && p.chargedAmount > p.amount ? p.chargedAmount - p.amount : 0;
  const yearBranch = [p.studentYear ? ROMAN[p.studentYear] ?? String(p.studentYear) : "", p.studentDepartment ?? ""].filter(Boolean);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fee Receipt ${esc(p.receiptNo ?? p.id)}</title><style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 13px; }
  .page { width: 186mm; margin: 0 auto; }
  .box { position: relative; border: 2px solid #111; padding: 6mm 7mm 7mm; }
  .copy { position: absolute; top: 3mm; right: 4mm; font-weight: bold; font-size: 12px; letter-spacing: .5px; }
  .head { display: grid; grid-template-columns: 26mm 1fr 26mm; align-items: center; }
  .head img { width: 22mm; height: 22mm; object-fit: contain; }
  .center { text-align: center; }
  .uni { font-size: 20px; font-weight: bold; margin: 0; }
  .place { font-size: 13px; font-weight: bold; margin: 1mm 0 0; }
  .title { font-size: 14px; font-weight: bold; margin: 2mm 0 0; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10mm; margin-top: 4mm; }
  .kv { display: grid; grid-template-columns: 34mm 4mm 1fr; padding: .8mm 0; }
  .kv b { font-weight: bold; }
  .line { display: flex; gap: 3mm; align-items: baseline; margin-top: 3mm; }
  .fill { flex: 1; border-bottom: 1px dotted #333; padding: 0 1mm .5mm; font-weight: bold; }
  .from { display: grid; grid-template-columns: auto 1fr auto auto auto; gap: 4mm; align-items: baseline; margin-top: 4mm; border-bottom: 1px dotted #333; padding-bottom: .5mm; font-weight: bold; }
  .from span:first-child { font-weight: normal; }
  .bottom { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; margin-top: 4mm; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 1.2mm 0; }
  td.amt { text-align: right; width: 32mm; }
  tr.total td { border-top: 1.5px solid #111; border-bottom: 1.5px solid #111; font-weight: bold; padding: 1.8mm 0; }
  .note { font-size: 11px; color: #333; margin-top: 2mm; }
  .sign { display: flex; flex-direction: column; justify-content: flex-end; align-items: center; text-align: center; min-height: 34mm; }
  .stamp { margin-top: 3mm; display: inline-block; border: 2px solid #b91c1c; color: #b91c1c; font-weight: bold; padding: 1mm 3mm; transform: rotate(-4deg); }
  .gen { font-size: 10.5px; color: #444; margin-top: 1.5mm; }
  @media print { .noprint { display: none; } }
</style></head><body><div class="page"><div class="box">
  <span class="copy">${esc(d.copy ?? "STUDENT")}</span>
  <div class="head">
    <img src="${esc(logoSrc(d.college.logoUrl))}" alt="College logo" />
    <div class="center">
      <p class="uni">${esc(d.college.name)}</p>
      ${d.college.place ? `<p class="place">${esc(d.college.place)}</p>` : ""}
      <p class="title">${esc(p.purpose.label)} Fee Receipt</p>
    </div><span></span>
  </div>
  <div class="meta">
    <div>
      <div class="kv"><span>No</span><span>:</span><b>${esc(p.receiptNo ?? p.id)}</b></div>
      <div class="kv"><span>Dated</span><span>:</span><b>${esc(paidOn)}</b></div>
      <div class="kv"><span>Receipt Mode</span><span>:</span><b>${esc(mode)}</b></div>
    </div>
    <div>
      <div class="kv"><span>Transaction ID</span><span>:</span><b>${esc(p.trackingId ?? "")}</b></div>
      <div class="kv"><span>Txn Date</span><span>:</span><b>${esc(paidOn)}</b></div>
      <div class="kv"><span>Bank Ref No</span><span>:</span><b>${esc(p.bankRefNo ?? "")}</b></div>
    </div>
  </div>
  <div class="line"><span>Received With Thanks Sum of Rupees :</span><span class="fill">${esc(rupeesInWords(p.amount))}</span></div>
  <div class="from"><span>From</span><span>${esc(p.studentName)}</span><span>${esc(p.studentRollNumber)}</span>${yearBranch.map((x) => `<span>${esc(x)}</span>`).join("")}</div>
  <div class="line"><span>towards ${esc(p.academicYear ?? "")} Fee</span><span class="fill">${money(p.amount)}</span><span>By Online :</span><span class="fill">CCAvenue · Order ${esc(p.id)}</span></div>
  <div class="bottom">
    <div>
      <table>
        <tr><td>${esc(p.purpose.label)} Fee</td><td class="amt">${money(p.amount)}</td></tr>
        <tr class="total"><td>Total</td><td class="amt">${money(p.amount)}</td></tr>
      </table>
      ${gateway > 0 ? `<p class="note">Paid online Rs. ${money(p.chargedAmount!)}, including Rs. ${money(gateway)} CCAvenue convenience fee + tax (charged by the gateway).</p>` : ""}
      <p style="margin-top:4mm">Narration : ${esc([yearBranch.join(" "), p.academicYear, p.purpose.label].filter(Boolean).join(" · "))}</p>
      ${p.refundedAmount ? `<span class="stamp">REFUNDED Rs. ${money(p.refundedAmount)}</span>` : ""}
    </div>
    <div class="sign">
      <p>For &nbsp; <b>${esc(d.college.name)}</b></p>
      <p style="margin-top:12mm">Authorised Signatory</p>
      <p class="gen">Computer-generated receipt for an online payment - no signature required.</p>
    </div>
  </div>
</div></div></body></html>`;
}
