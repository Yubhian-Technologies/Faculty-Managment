function rupees(n: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

const BASE_STYLE = `
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; color: #111; }
  .page { width: 210mm; min-height: 297mm; padding: 18mm 20mm; box-sizing: border-box; }
  .header { text-align: center; border-bottom: 3px double #1d4ed8; padding-bottom: 14px; margin-bottom: 20px; }
  .college-name { font-size: 22px; font-weight: bold; color: #1d4ed8; margin: 0; }
  .title { text-align: center; font-size: 16px; font-weight: bold; text-decoration: underline; margin: 16px 0; letter-spacing: 1px; }
  .meta { margin-bottom: 16px; font-size: 12px; color: #444; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th { background: #1d4ed8; color: #fff; padding: 8px 12px; font-size: 12px; text-align: left; }
  td { padding: 8px 12px; font-size: 12px; border: 1px solid #ddd; }
  tr:nth-child(even) td { background: #f8fafc; }
  .stat-grid { display: flex; gap: 12px; margin: 16px 0; }
  .stat-box { flex: 1; border: 1px solid #ddd; border-radius: 6px; padding: 12px; text-align: center; }
  .stat-label { font-size: 11px; color: #666; }
  .stat-value { font-size: 18px; font-weight: bold; color: #1d4ed8; margin-top: 4px; }
`;

export function getFinanceReportHTML({
  collegeName,
  periodLabel,
  totalAllocated,
  totalUtilized,
  totalPayments,
  pendingApprovals,
  byDepartment,
  generatedAt,
}: {
  collegeName: string;
  periodLabel: string;
  totalAllocated: number;
  totalUtilized: number;
  totalPayments: number;
  pendingApprovals: number;
  byDepartment: Record<string, { allocated: number; utilized: number }>;
  generatedAt: string;
}): string {
  const rows = Object.entries(byDepartment)
    .map(
      ([dept, v]) => `<tr><td>${dept}</td><td>${rupees(v.allocated)}</td><td>${rupees(v.utilized)}</td><td>${rupees(v.allocated - v.utilized)}</td></tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${BASE_STYLE}</style>
</head>
<body>
<div class="page">
  <div class="header">
    <p class="college-name">${collegeName}</p>
  </div>
  <div class="title">FINANCIAL REPORT — ${periodLabel}</div>
  <div class="meta">Generated: ${new Date(generatedAt).toLocaleString("en-IN")}</div>

  <div class="stat-grid">
    <div class="stat-box"><div class="stat-label">Total Allocated</div><div class="stat-value">${rupees(totalAllocated)}</div></div>
    <div class="stat-box"><div class="stat-label">Total Utilized</div><div class="stat-value">${rupees(totalUtilized)}</div></div>
    <div class="stat-box"><div class="stat-label">Total Payments</div><div class="stat-value">${rupees(totalPayments)}</div></div>
    <div class="stat-box"><div class="stat-label">Pending Approvals</div><div class="stat-value">${pendingApprovals}</div></div>
  </div>

  <table>
    <thead><tr><th>Department</th><th>Allocated</th><th>Utilized</th><th>Remaining</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="4">No budget activity in this period</td></tr>`}</tbody>
  </table>
</div>
</body>
</html>`;
}

export function getFinanceReceiptHTML({
  collegeName,
  relatedType,
  relatedId,
  amount,
  description,
  verified,
  createdByName,
  createdAt,
}: {
  collegeName: string;
  relatedType: string;
  relatedId: string;
  amount: number;
  description: string;
  verified: boolean;
  createdByName: string;
  createdAt: string;
}): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${BASE_STYLE}</style>
</head>
<body>
<div class="page">
  <div class="header">
    <p class="college-name">${collegeName}</p>
  </div>
  <div class="title">FINANCE RECEIPT</div>
  <div class="meta">Issued: ${new Date(createdAt).toLocaleString("en-IN")}</div>

  <table>
    <tbody>
      <tr><td><strong>Related To</strong></td><td>${relatedType} (${relatedId})</td></tr>
      <tr><td><strong>Description</strong></td><td>${description}</td></tr>
      <tr><td><strong>Amount</strong></td><td>${rupees(amount)}</td></tr>
      <tr><td><strong>Status</strong></td><td>${verified ? "Verified" : "Unverified"}</td></tr>
      <tr><td><strong>Recorded By</strong></td><td>${createdByName}</td></tr>
    </tbody>
  </table>
</div>
</body>
</html>`;
}
