import { VISHNU_LOGO_URL } from "@/lib/pdf/logo";

// One A4 page, split into two identical halves so the printed sheet can be
// cut in two: the top half stays with the College Office, the bottom half is
// given to the student as their receipt. Each half is independently
// self-contained (own header, own signature line) since they're physically
// separated after printing.

const BASE_STYLE = `
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; color: #111; }
  .page { width: 210mm; height: 297mm; box-sizing: border-box; display: flex; flex-direction: column; }
  .half { height: 148.5mm; box-sizing: border-box; padding: 12mm 18mm; position: relative; }
  .cut-line { border-top: 1px dashed #999; position: relative; }
  .cut-line::before { content: "\\2704 cut here"; position: absolute; top: -8px; left: 50%; transform: translateX(-50%); background: #fff; padding: 0 8px; font-size: 9px; color: #999; }
  .copy-tag { position: absolute; top: 8mm; right: 10mm; font-size: 10px; font-weight: bold; color: #888; letter-spacing: 1px; }
  .header { text-align: center; border-bottom: 2px double #1d4ed8; padding-bottom: 8px; margin-bottom: 14px; }
  .header img { height: 40px; width: auto; object-fit: contain; margin-bottom: 4px; }
  .college-name { font-size: 16px; font-weight: bold; color: #1d4ed8; margin: 0; }
  .title { text-align: center; font-size: 14px; font-weight: bold; text-decoration: underline; margin: 10px 0; letter-spacing: 1px; }
  .meta { font-size: 11px; color: #444; text-align: right; margin-bottom: 10px; }
  .body-text { font-size: 12px; line-height: 1.6; margin: 10px 0; }
  table.facts { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 11px; }
  table.facts td { padding: 4px 8px; vertical-align: middle; }
  table.facts td.label { color: #555; width: 35%; }
  table.clearances { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 11px; }
  table.clearances th { background: #1d4ed8; color: #fff; padding: 5px 10px; text-align: left; vertical-align: middle; }
  table.clearances td { padding: 5px 10px; border: 1px solid #ddd; vertical-align: middle; }
  .status-cleared { color: #15803d; font-weight: bold; }
  .signature { margin-top: 14px; font-size: 11px; display: flex; justify-content: flex-end; }
  .signature .sig-line { border-top: 1px solid #444; width: 180px; padding-top: 4px; text-align: center; }
  .signature .sig-name { font-weight: bold; }
  .signature .sig-role { color: #444; }
`;

export interface CertificateTemplateData {
  certificateTypeLabel: string;
  certificateNumber: string;
  collegeName: string;
  studentName: string;
  studentRollNumber: string;
  studentDepartment: string;
  studentYear: number;
  studentSection: string;
  clearances: { branchLabel: string; decidedAt: string }[];
  issuedByName: string;
  issuedAt: string;
}

function renderHalf(data: CertificateTemplateData, copyTag: string): string {
  const clearanceRows = data.clearances
    .map((c) => `<tr><td>${c.branchLabel}</td><td class="status-cleared">Cleared</td><td>${new Date(c.decidedAt).toLocaleDateString("en-IN")}</td></tr>`)
    .join("");

  return `
  <div class="half">
    <div class="copy-tag">${copyTag}</div>
    <div class="header">
      <img src="${VISHNU_LOGO_URL}" alt="College Logo" />
      <p class="college-name">${data.collegeName}</p>
    </div>
    <div class="title">${data.certificateTypeLabel.toUpperCase()}</div>
    <div class="meta">Certificate No: ${data.certificateNumber} &nbsp;|&nbsp; Date: ${new Date(data.issuedAt).toLocaleDateString("en-IN")}</div>

    <table class="facts">
      <tr><td class="label">Student Name</td><td>${data.studentName}</td></tr>
      <tr><td class="label">Roll Number</td><td>${data.studentRollNumber}</td></tr>
      <tr><td class="label">Department</td><td>${data.studentDepartment}</td></tr>
      <tr><td class="label">Year / Section</td><td>${data.studentYear} / ${data.studentSection}</td></tr>
    </table>

    <p class="body-text">This is to certify that the above student has no dues pending with the following departments as of the date above:</p>

    <table class="clearances">
      <thead><tr><th>Department</th><th>Status</th><th>Cleared On</th></tr></thead>
      <tbody>${clearanceRows}</tbody>
    </table>

    <div class="signature">
      <div class="sig-line">
        <div class="sig-name">${data.issuedByName}</div>
        <div class="sig-role">College Office, ${data.collegeName}</div>
      </div>
    </div>
  </div>`;
}

export function getNoDueCertificateHTML(data: CertificateTemplateData): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${BASE_STYLE}</style>
</head>
<body>
<div class="page">
  ${renderHalf(data, "OFFICE COPY")}
  <div class="cut-line"></div>
  ${renderHalf(data, "STUDENT COPY")}
</div>
</body>
</html>`;
}

// One generic renderer is enough while No-Due is the only shipped type -
// CertificateTypeDef.templateKey is stored so a future type's different
// layout has somewhere to branch to without a data migration.
export function getCertificateHTML(data: CertificateTemplateData): string {
  return getNoDueCertificateHTML(data);
}
