import type { PayslipData } from "@/lib/payroll/payslip";
import { rupeesInWords } from "./feeReceiptTemplate";
import { logoSrc } from "./logo";

// Payslip, A4 portrait, one page: letterhead, the person, pay days, earnings (fixed and earned) beside
// deductions, net in figures and words. "Preview - not released" across the top until the month is released.

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const inr = (n: number) => n.toLocaleString("en-IN");
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

export function getPayslipHTML(d: PayslipData): string {
  const earnRows = [...d.earnings.map((e) => [e.label, inr(e.fixed), inr(e.earned)]), ...d.oneOffs.map((o) => [o.label, "", inr(o.amount)])];
  const dedRows = d.deductions.map((x) => [x.label, inr(x.amount)]);
  const rows = Math.max(earnRows.length, dedRows.length);
  let body = "";
  for (let i = 0; i < rows; i++) {
    const e = earnRows[i] ?? ["", "", ""], x = dedRows[i] ?? ["", ""];
    body += `<tr><td>${esc(e[0])}</td><td class="n">${esc(e[1])}</td><td class="n">${esc(e[2])}</td><td>${esc(x[0])}</td><td class="n">${esc(x[1])}</td></tr>`;
  }
  const info: [string, string][] = [
    ["Name", d.person.name], ["Employee ID", d.person.employeeCode || "-"], ["Designation", d.person.designation || "-"], ["Department", d.person.department || "-"],
    ["Bank A/c", d.person.bank || "-"], ["PAN", d.person.pan ?? "-"], ["UAN", d.person.uan ?? "-"],
    ["Days in month", String(d.monthDays)], ["Pay days", String(d.payDays)], ["Loss of pay", String(d.lop)],
  ];
  return `<!doctype html><html><head><meta charset="utf-8"><title>Payslip ${esc(d.month)}</title><style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12.5px; }
  .page { width: 186mm; margin: 0 auto; }
  .head { display: grid; grid-template-columns: 22mm 1fr 22mm; align-items: center; border-bottom: 2px solid #111; padding-bottom: 3mm; }
  .head img { width: 20mm; height: 20mm; object-fit: contain; }
  h1 { margin: 0; font-size: 18px; text-align: center; text-transform: uppercase; }
  h2 { margin: 2mm 0 0; font-size: 14px; text-align: center; font-weight: normal; }
  .preview { margin: 3mm 0 0; padding: 2mm; text-align: center; border: 1.5px dashed #b45309; color: #b45309; font-weight: bold; }
  .info { display: grid; grid-template-columns: 1fr 1fr; gap: 1mm 8mm; margin: 4mm 0; }
  .info div { display: flex; justify-content: space-between; border-bottom: 1px dotted #999; padding: 1mm 0; }
  .info span:first-child { color: #555; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #333; padding: 1.6mm 2mm; }
  th { background: #eee; text-align: left; }
  .n { text-align: right; font-variant-numeric: tabular-nums; }
  .tot td { font-weight: bold; background: #f6f6f6; }
  .net { margin-top: 4mm; border: 2px solid #111; padding: 3mm; display: flex; justify-content: space-between; font-size: 15px; font-weight: bold; }
  .words { margin-top: 1.5mm; }
  .note { margin-top: 3mm; color: #b91c1c; }
  .foot { margin-top: 10mm; color: #555; font-size: 11px; text-align: center; }
  </style></head><body><div class="page">
  <div class="head"><img src="${esc(logoSrc(d.college.logoUrl))}" alt=""><div><h1>${esc(d.college.name)}</h1><h2>Payslip for ${esc(monthName(d.month))}</h2></div><div></div></div>
  ${d.final ? "" : `<div class="preview">PREVIEW - this month is not released yet; figures may change</div>`}
  <div class="info">${info.map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("")}</div>
  <table><thead><tr><th>Earnings</th><th class="n">Fixed</th><th class="n">Earned</th><th>Deductions</th><th class="n">Amount</th></tr></thead>
  <tbody>${body}<tr class="tot"><td>Gross salary</td><td></td><td class="n">${inr(d.gross)}</td><td>Total deductions</td><td class="n">${inr(d.totalDeductions)}</td></tr></tbody></table>
  <div class="net"><span>Net salary</span><span>₹${inr(d.net)}</span></div>
  <div class="words">${esc(rupeesInWords(d.net))}</div>
  ${d.notCredited ? `<div class="note">Salary not credited: ${esc(d.notCredited)}</div>` : ""}
  ${d.onHold ? `<div class="note">Salary on hold: ${esc(d.onHold)}</div>` : ""}
  ${d.paidOn ? `<div style="margin-top:2mm">Paid on ${esc(d.paidOn)}</div>` : ""}
  <div class="foot">This is a computer-generated payslip and does not need a signature.</div>
  </div></body></html>`;
}
