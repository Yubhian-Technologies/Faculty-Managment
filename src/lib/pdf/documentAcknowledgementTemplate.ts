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
  .status-yes { color: #15803d; font-weight: bold; }
  .status-no { color: #b91c1c; font-weight: bold; }
  .signature { margin-top: 60px; font-size: 12px; }
`;

export function getDocumentAcknowledgementHTML({
  collegeName,
  candidateName,
  position,
  department,
  checkedDocs,
  verifiedByName,
  verifiedAt,
}: {
  collegeName: string;
  candidateName: string;
  position: string;
  department: string;
  checkedDocs: Record<string, boolean>;
  verifiedByName: string;
  verifiedAt: string;
}): string {
  const rows = Object.entries(checkedDocs)
    .map(
      ([doc, checked]) =>
        `<tr><td>${doc}</td><td class="${checked ? "status-yes" : "status-no"}">${checked ? "Received" : "Pending"}</td></tr>`
    )
    .join("");
  const receivedCount = Object.values(checkedDocs).filter(Boolean).length;
  const totalCount = Object.keys(checkedDocs).length;

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
  <div class="title">DOCUMENT VERIFICATION ACKNOWLEDGEMENT</div>
  <div class="meta">Issued: ${new Date(verifiedAt).toLocaleString("en-IN")}</div>

  <table>
    <tbody>
      <tr><td><strong>Candidate</strong></td><td>${candidateName}</td></tr>
      <tr><td><strong>Position</strong></td><td>${position}</td></tr>
      <tr><td><strong>Department</strong></td><td>${department}</td></tr>
      <tr><td><strong>Documents Received</strong></td><td>${receivedCount} of ${totalCount}</td></tr>
    </tbody>
  </table>

  <table>
    <thead><tr><th>Document</th><th>Status</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="2">No documents listed</td></tr>`}</tbody>
  </table>

  <div class="signature">Verified By: ${verifiedByName}</div>
</div>
</body>
</html>`;
}
