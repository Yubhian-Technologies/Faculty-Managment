import { logoSrc } from "@/lib/pdf/logo";
import { rupeesInWords } from "@/lib/pdf/feeReceiptTemplate";
import { dmy } from "@/lib/utils";

// Print-ready receipt for a student fee payment (counter or online), laid out like the online-payment fee receipt
// (feeReceiptTemplate.ts): letterhead, No / Dated / mode, amount in words, the student, what it paid (instalment x
// fee head), how much was credited to each college bank account, and "For <college> / Authorised Signatory".
// A cancelled receipt carries a CANCELLED stamp.

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MODE: Record<string, string> = { CASH: "Cash", DD: "Demand Draft", UPI: "UPI", BANK: "Bank Transfer", CHEQUE: "Cheque", ONLINE: "Online - CCAvenue" };

export interface StudentFeeReceiptData {
  receipt: {
    receiptNo: string; academicYear: string; amount: number; mode: string; reference: string; bank?: string; paidOn: string;
    allocation: { no: number; label: string; headName?: string; bankAccountName?: string; amount: number }[]; rollNumber: string; name: string; department: string; section: string; courseName: string;
    cancelled?: boolean | { reason: string } | null;
    remarks?: string;
  };
  college: { name: string; place?: string; logoUrl?: string };
  copy?: string;
}

export function getStudentFeeReceiptHTML(d: StudentFeeReceiptData): string {
  const r = d.receipt;
  const rows = r.allocation.length ? r.allocation.map((x) => ({ label: x.headName ? `${x.headName} (${x.label})` : x.label, amount: x.amount })) : [{ label: `${r.academicYear} Fee`, amount: r.amount }];
  const accounts = new Map<string, number>();
  for (const x of r.allocation) if (x.bankAccountName) accounts.set(x.bankAccountName, (accounts.get(x.bankAccountName) ?? 0) + x.amount);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fee Receipt ${esc(r.receiptNo)}</title><style>
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
  .line { display: flex; gap: 3mm; align-items: baseline; margin-top: 3mm; }
  .fill { flex: 1; border-bottom: 1px dotted #333; padding: 0 1mm .5mm; font-weight: bold; }
  .bottom { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; margin-top: 4mm; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 1.2mm 0; }
  td.amt { text-align: right; width: 32mm; }
  tr.total td { border-top: 1.5px solid #111; border-bottom: 1.5px solid #111; font-weight: bold; padding: 1.8mm 0; }
  .sign { display: flex; flex-direction: column; justify-content: flex-end; align-items: center; text-align: center; min-height: 34mm; }
  .stamp { margin-top: 3mm; display: inline-block; border: 2px solid #b91c1c; color: #b91c1c; font-weight: bold; padding: 1mm 3mm; transform: rotate(-4deg); }
</style></head><body><div class="page"><div class="box">
  <span class="copy">${esc(d.copy ?? "STUDENT")}</span>
  <div class="head">
    <img src="${esc(logoSrc(d.college.logoUrl))}" alt="College logo" />
    <div class="center">
      <p class="uni">${esc(d.college.name)}</p>
      ${d.college.place ? `<p class="place">${esc(d.college.place)}</p>` : ""}
      <p class="title">Fee Receipt</p>
    </div><span></span>
  </div>
  <div class="meta">
    <div>
      <div class="kv"><span>No</span><span>:</span><b>${esc(r.receiptNo)}</b></div>
      <div class="kv"><span>Dated</span><span>:</span><b>${esc(dmy(r.paidOn))}</b></div>
      <div class="kv"><span>Receipt Mode</span><span>:</span><b>${esc(MODE[r.mode] ?? r.mode)}</b></div>
    </div>
    <div>
      <div class="kv"><span>Reference</span><span>:</span><b>${esc(r.reference || "-")}</b></div>
      <div class="kv"><span>Bank</span><span>:</span><b>${esc(r.bank || "-")}</b></div>
      <div class="kv"><span>Academic Year</span><span>:</span><b>${esc(r.academicYear)}</b></div>
    </div>
  </div>
  <div class="line"><span>Received With Thanks Sum of Rupees :</span><span class="fill">${esc(rupeesInWords(r.amount))}</span></div>
  <div class="line"><span>From</span><span class="fill">${esc(r.name)} · ${esc(r.rollNumber)} · ${esc([r.courseName, r.department, r.section ? `Section ${r.section}` : ""].filter(Boolean).join(" · "))}</span></div>
  <div class="bottom">
    <div>
      <table>
        ${rows.map((x) => `<tr><td>${esc(x.label)}</td><td class="amt">${money(x.amount)}</td></tr>`).join("")}
        <tr class="total"><td>Total</td><td class="amt">${money(r.amount)}</td></tr>
      </table>
      ${accounts.size ? `<p style="margin:3mm 0 1mm;font-weight:bold">Credited To</p><table>${[...accounts].map(([a, v]) => `<tr><td>${esc(a)}</td><td class="amt">${money(v)}</td></tr>`).join("")}</table>` : ""}
      ${r.remarks && r.remarks !== "Imported from the previous system" ? `<p style="margin:3mm 0 0;font-size:11px">${esc(r.remarks)}</p>` : ""}
      ${r.mode === "CHEQUE" || r.mode === "DD" ? `<p style="margin:2mm 0 0;font-size:11px;font-weight:bold">Subject to realisation of the ${r.mode === "DD" ? "Demand Draft" : "cheque"}.</p>` : ""}
      ${r.cancelled ? `<span class="stamp">CANCELLED</span>` : ""}
    </div>
    <div class="sign">
      <p>For &nbsp; <b>${esc(d.college.name)}</b></p>
      <p style="margin-top:12mm">Authorised Signatory</p>
    </div>
  </div>
</div></div></body></html>`;
}

/** Opens the receipt in a print window (the browser's Save as PDF gives the PDF). */
export async function printStudentFeeReceipt(d: StudentFeeReceiptData): Promise<void> {
  const win = window.open("", "_blank");
  if (!win) throw new Error("Allow pop-ups to print the receipt.");
  win.document.open();
  win.document.write(getStudentFeeReceiptHTML(d));
  win.document.close();
  const img = win.document.querySelector("img");
  if (img && !img.complete) await new Promise((res) => { img.onload = res; img.onerror = res; setTimeout(res, 3000); });
  win.focus();
  win.print();
}
