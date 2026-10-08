import { escapeHtml } from "./facultyTimetablePdf";
import { resolveLogoUrl } from "./logoAsset";

export interface ReportCollege {
  name?: string;
  code?: string;
  affiliation?: string;
  address?: string;
  phone?: string;
  logoUrl?: string;
}

export interface ReportPdfOptions {
  college?: ReportCollege;
  /** Bold line under the letterhead, e.g. "LEISURE FACULTY". */
  title: string;
  /** Centred line under the title, e.g. "Monday, Period 3 · 12 free". */
  subtitle?: string;
  /** Pre-built `<table class="report">` markup (see reportTableHtml). */
  bodyHtml: string;
}

/** One table cell of the report: bordered, vertically centred like the class timetable's cells. */
export const reportCell = (text: string | number, opts: { head?: boolean; left?: boolean; width?: string; colspan?: number } = {}) => {
  const tag = opts.head ? "th" : "td";
  const attrs = `class="cell${opts.left ? " left" : ""}"${opts.width ? ` style="width:${opts.width}"` : ""}${opts.colspan ? ` colspan="${opts.colspan}"` : ""}`;
  return `<${tag} ${attrs}><div class="fx${opts.left ? " fx-left" : ""}">${escapeHtml(String(text))}</div></${tag}>`;
};

/**
 * A printable report in the class timetable's PDF style: the college letterhead
 * (logo, name, address, phone), a bold title, a subtitle line, then plain
 * black-and-white bordered tables. The letterhead block carries
 * `pdf-page-header`, which renderHtmlToPdf stamps again at the top of every
 * continuation page.
 */
export function buildReportPdfHtml(opts: ReportPdfOptions): string {
  const c = opts.college ?? {};
  const identity = [c.affiliation, c.address, c.phone ? `Tel : ${c.phone}` : ""]
    .filter(Boolean)
    .map((l) => `<div class="identity-line">${escapeHtml(l as string)}</div>`)
    .join("");
  const nameLine = c.name ? `<div class="inst-name">${escapeHtml(c.name)}${c.code ? ` ( Code: ${escapeHtml(c.code)} )` : ""}</div>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(opts.title)}</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; font-size: 11px; line-height: 1.3; }
    .page { width: 210mm; margin: 0 auto; padding: 10mm 10mm 14mm; }
    .letterhead { width: 100%; border: 0; }
    .logo-cell { width: 26mm; vertical-align: middle; text-align: center; }
    .logo-cell img { max-width: 24mm; max-height: 24mm; object-fit: contain; }
    .letterhead-text { vertical-align: middle; text-align: center; }
    .inst-name { font-size: 13pt; font-weight: 700; overflow-wrap: anywhere; }
    .identity-line { font-size: 10pt; font-weight: 700; overflow-wrap: anywhere; }
    .doc-title { text-align: center; font-size: 12pt; font-weight: 700; margin: 12px 0 4px; }
    .class-line { text-align: center; font-size: 9.5pt; font-weight: 600; margin-bottom: 8px; overflow-wrap: anywhere; }
    table.report { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; border-top: 1px solid #555; border-left: 1px solid #555; }
    .cell { border-right: 1px solid #555; border-bottom: 1px solid #555; padding: 0; text-align: center; vertical-align: middle; line-height: 1.2; overflow-wrap: anywhere; font-size: 9pt; }
    .fx { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; min-height: 26px; padding: 0 6px; }
    .fx-left { align-items: flex-start; text-align: left; }
    th.cell { font-weight: 700; background: #fff; }
    th.cell > .fx { min-height: 28px; }
    td.group-cell { background: #f3f3f3; font-weight: 700; }
  </style>
</head>
<body>
  <div class="page">
    <div class="pdf-page-header">
      <table class="letterhead" cellspacing="0" cellpadding="0">
        <tr>
          <td class="logo-cell"><img src="${escapeHtml(resolveLogoUrl(c.logoUrl))}" alt="logo"></td>
          <td class="letterhead-text">${nameLine}${identity}</td>
          <td class="logo-cell"></td>
        </tr>
      </table>
      <div class="doc-title">${escapeHtml(opts.title)}</div>
      ${opts.subtitle ? `<div class="class-line">${escapeHtml(opts.subtitle)}</div>` : ""}
    </div>
    ${opts.bodyHtml}
  </div>
</body>
</html>`;
}
