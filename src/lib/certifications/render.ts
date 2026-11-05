import qrcode from "qrcode-generator";
import { toRoman } from "@/lib/academic/format";
import { logoSrc } from "@/lib/pdf/logo";
import type { CertificateSignature, CertificateTemplate } from "@/types";
import type { StudentResultsView } from "@/lib/examResults/studentResults";

// Builds a certificate as one print-ready A4 HTML page - pure, shared by the issuer's preview and the issued copy
// (the frozen page kept in Storage, turned into a PDF in the browser like the other documents of the app).
// Placeholders are {{name}}; one with no value prints as a blank line ("______"), and the preview marks it.

export interface CertificateData {
  college: { name: string; address?: string; logoUrl?: string };
  /** Text values by placeholder name (student record, request, issuer fields, numbering). */
  values: Record<string, string>;
  marks?: StudentResultsView | null;
  signature?: CertificateSignature | null;
  certificateNumber?: string;
  verifyUrl?: string;
  /** Preview: missing values are highlighted and a PREVIEW mark is shown. */
  preview?: boolean;
  /** Each department's clearance, for a template with showClearances (the No Dues table). */
  clearances?: { label: string; status: string; by: string; date: string }[];
}

/** Every placeholder the editor offers, grouped - type-specific form / issuer fields are added by key. */
export const PLACEHOLDER_GROUPS: { title: string; items: { key: string; label: string }[] }[] = [
  {
    title: "Student",
    items: [
      { key: "studentName", label: "Name" }, { key: "rollNumber", label: "Regd. No" }, { key: "admissionNo", label: "Admission No" },
      { key: "fatherName", label: "Father's name" }, { key: "motherName", label: "Mother's name" }, { key: "gender", label: "Gender" },
      { key: "sonDaughter", label: "son / daughter" }, { key: "heShe", label: "he / she" }, { key: "hisHer", label: "his / her" }, { key: "himHer", label: "him / her" }, { key: "MrMs", label: "Mr. / Ms." },
      { key: "dateOfBirth", label: "Date of birth" }, { key: "nationality", label: "Nationality" }, { key: "religion", label: "Religion" }, { key: "caste", label: "Caste" },
      { key: "permanentAddress", label: "Permanent address" }, { key: "dateOfAdmission", label: "Date of admission" },
    ],
  },
  {
    title: "Course",
    items: [
      { key: "course", label: "Course" }, { key: "branch", label: "Branch" }, { key: "year", label: "Year (III)" }, { key: "semester", label: "Semester (I / II)" }, { key: "section", label: "Section" },
      { key: "academicYear", label: "Academic year" }, { key: "batch", label: "Batch" }, { key: "regulation", label: "Regulation" }, { key: "studentStatus", label: "Status (studying / completed)" },
      { key: "cgpa", label: "CGPA" },
    ],
  },
  {
    title: "Certificate",
    items: [
      { key: "certificateNumber", label: "Certificate number" }, { key: "issueDate", label: "Date of issue" }, { key: "purpose", label: "Purpose" },
      { key: "requestDate", label: "Date applied" }, { key: "feeReceiptNo", label: "Fee receipt no." }, { key: "collegeName", label: "College name" },
    ],
  },
];

export function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Replaces {{key}} in already-escaped text. */
export function fillPlaceholders(text: string, values: Record<string, string>, preview = false): string {
  return escapeHtml(text).replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g, (_m, key: string) => {
    const v = values[key];
    if (v && v.trim()) return `<b>${escapeHtml(v.trim())}</b>`;
    return preview ? `<span class="missing">{{${key}}}</span>` : "__________";
  });
}

/** Placeholders a text uses that have no value - shown to the issuer before issuing. */
export function missingPlaceholders(texts: string[], values: Record<string, string>): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g)) if (!values[m[1]]?.trim()) out.add(m[1]);
  return [...out];
}

export function qrSvg(text: string, size = 92): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const cell = Math.max(2, Math.floor(size / qr.getModuleCount()));
  return qr.createSvgTag(cell, 0);
}

const paragraphs = (html: string) => html.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`).join("");

function marksHtml(kind: CertificateTemplate["marksKind"], marks: StudentResultsView | null | undefined, semester: number | null): string {
  if (!marks || marks.semesters.length === 0) return `<p class="note">No published results for this student yet.</p>`;
  const fmt = (n: number | null) => (n == null ? "-" : n.toFixed(marks.decimals ?? 2));
  const subjectTable = (s: StudentResultsView["semesters"][number]) => `
    <table class="grid"><thead><tr><th>#</th><th>Code</th><th>Subject</th><th>Credits</th><th>Grade</th><th>Result</th></tr></thead><tbody>
    ${s.subjects.map((sub, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(sub.subjectCode)}</td><td class="l">${escapeHtml(sub.subjectName)}</td><td>${sub.credits}</td><td>${escapeHtml(sub.grade)}</td><td>${sub.isPass ? "Pass" : "Fail"}</td></tr>`).join("")}
    </tbody></table>
    <p class="sgpa">Semester ${s.semester} (Year ${toRoman(s.year)}) - Credits: ${s.credits} &nbsp; SGPA: <b>${s.sgpaWithheld ? "Withheld" : fmt(s.sgpa)}</b></p>`;
  if (kind === "SEMESTER") {
    const s = marks.semesters.find((x) => x.semester === semester) ?? marks.semesters[marks.semesters.length - 1];
    return subjectTable(s);
  }
  if (kind === "CONSOLIDATED") {
    return `<table class="grid"><thead><tr><th>Semester</th><th>Year</th><th>Credits</th><th>SGPA</th><th>Backlogs</th></tr></thead><tbody>
      ${marks.semesters.map((s) => `<tr><td>${s.semester}</td><td>${toRoman(s.year)}</td><td>${s.credits}</td><td>${s.sgpaWithheld ? "Withheld" : fmt(s.sgpa)}</td><td>${s.backlogs.length}</td></tr>`).join("")}
      </tbody></table>
      <p class="sgpa">Credits earned: <b>${marks.creditsEarned}</b> &nbsp; CGPA: <b>${marks.cgpaWithheld ? "Withheld" : fmt(marks.cgpa)}</b></p>`;
  }
  return `${marks.semesters.map((s) => `<h3>Semester ${s.semester}</h3>${subjectTable(s)}`).join("")}
    <p class="sgpa">Credits earned: <b>${marks.creditsEarned}</b> &nbsp; CGPA: <b>${marks.cgpaWithheld ? "Withheld" : fmt(marks.cgpa)}</b></p>`;
}

/** A font size that keeps the college name on one line beside the logo (longer names print smaller). */
export function collegeNamePt(name: string): number {
  const len = name.trim().length;
  return len <= 30 ? 21 : Math.max(11, Math.floor((21 * 30) / len));
}

export function renderCertificateHtml(template: CertificateTemplate, data: CertificateData): string {
  const v: Record<string, string> = { ...data.values, collegeName: data.college.name, certificateNumber: data.certificateNumber ?? data.values.certificateNumber ?? "" };
  const fill = (t: string) => fillPlaceholders(t, v, data.preview);
  let body = "";
  if (template.kind === "LETTER") body = paragraphs(fill(template.body ?? ""));
  if (template.kind === "FORM") {
    body = `<table class="form">${(template.rows ?? []).map((r, i) => `<tr><td class="n">${i + 1}.</td><td class="k">${escapeHtml(r.label)}</td><td class="c">:</td><td>${fill(r.value)}</td></tr>`).join("")}</table>`;
  }
  if (template.kind === "MARKS") {
    body = `${template.body ? paragraphs(fill(template.body)) : ""}${marksHtml(template.marksKind, data.marks, Number(v.semester) || null)}`;
  }
  if (template.kind === "UPLOAD") body = `<p class="note">This certificate is issued as an uploaded document.</p>`;
  if (template.showClearances && template.kind !== "UPLOAD") {
    const rows = data.clearances ?? [];
    body += rows.length
      ? `<table class="grid clear"><thead><tr><th>#</th><th>Department</th><th>Status</th><th>Cleared by</th><th>Date</th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr><td>${i + 1}</td><td class="l">${escapeHtml(r.label)}</td><td class="${/Fail|Pending|Rejected/.test(r.status) ? "bad" : "ok"}">${escapeHtml(r.status)}</td><td class="l">${escapeHtml(r.by)}</td><td>${escapeHtml(r.date)}</td></tr>`).join("")}
        </tbody></table>`
      : `<p class="note">The departments' clearances are listed here when it is issued.</p>`;
  }

  const sig = data.signature;
  const qr = template.showQr && data.verifyUrl ? `<div class="qr">${qrSvg(data.verifyUrl)}<div>Scan to verify<br/>${escapeHtml(data.verifyUrl.replace(/^https?:\/\//, ""))}</div></div>` : `<div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(template.title)}</title><style>
    @page { size: A4; margin: 0; }
    body { font-family: "Times New Roman", Georgia, serif; color: #111; font-size: 14.5pt; line-height: 1.7; margin: 0; }
    /* The margins live on the page itself: the preview and the browser-made PDF ignore @page margins. */
    .page { position: relative; box-sizing: border-box; width: 100%; max-width: 210mm; margin: 0 auto; padding: 5mm; }
    .head { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #1f3a8a; padding-bottom: 8px; }
    .head img { height: 84px; width: auto; flex-shrink: 0; }
    .head .college { font-weight: 700; text-transform: uppercase; letter-spacing: .5px; white-space: nowrap; line-height: 1.2; }
    .head > div { min-width: 0; }
    .head .addr { font-size: 11.5pt; line-height: 1.35; color: #333; }
    .meta { display: flex; justify-content: space-between; font-size: 13pt; margin: 14px 0 6px; }
    h1 { text-align: center; font-size: 19pt; letter-spacing: 1.5px; text-decoration: underline; margin: 14px 0 12px; }
    h3 { font-size: 13.5pt; margin: 14px 0 4px; }
    p { text-align: justify; margin: 0 0 12px; }
    .note { color: #555; font-style: italic; }
    table.form { width: 100%; border-collapse: collapse; } table.form td { padding: 3px 4px; vertical-align: top; line-height: 1.45; }
    table.form td.n { width: 28px; } table.form td.k { width: 44%; } table.form td.c { width: 12px; }
    table.grid { width: 100%; border-collapse: collapse; font-size: 11.5pt; margin-top: 6px; }
    table.grid th, table.grid td { border: 1px solid #555; padding: 3px 5px; text-align: center; } table.grid td.l { text-align: left; }
    .sgpa { margin-top: 6px; text-align: right; }
    table.clear { margin-top: 10px; font-size: 11pt; } table.clear th, table.clear td { padding: 2px 6px; } table.clear td.ok { font-weight: 700; } table.clear td.bad { font-weight: 700; color: #b91c1c; }
    .foot { margin-top: 14px; font-size: 13pt; }
    .bottom { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 28px; break-inside: avoid-page; }
    .qr { display: flex; align-items: flex-end; gap: 8px; font-size: 10pt; color: #444; }
    .sign { text-align: center; min-width: 200px; } .sign img { height: 52px; display: block; margin: 0 auto 2px; }
    .sign .d { font-weight: 700; font-size: 15pt; }
    .missing { background: #fde68a; color: #92400e; padding: 0 3px; border-radius: 3px; font-family: monospace; font-size: 10pt; }
    .preview { position: absolute; top: 40%; left: 0; right: 0; text-align: center; font-size: 60pt; color: rgba(200,0,0,.08); transform: rotate(-20deg); pointer-events: none; }
  </style></head><body><div class="page">
    ${data.preview ? `<div class="preview">PREVIEW</div>` : ""}
    <div class="head"><img src="${escapeHtml(logoSrc(data.college.logoUrl))}" alt=""/><div><div class="college" style="font-size:${collegeNamePt(data.college.name)}pt">${escapeHtml(data.college.name)}</div>${data.college.address ? `<div class="addr">${escapeHtml(data.college.address)}</div>` : ""}</div></div>
    <div class="meta"><span>No: <b>${escapeHtml(v.certificateNumber || (data.preview ? "(given on issue)" : ""))}</b></span><span>Date: <b>${escapeHtml(v.issueDate ?? "")}</b></span></div>
    <h1>${escapeHtml(template.title)}</h1>
    ${body}
    ${template.footer ? `<div class="foot">${paragraphs(fill(template.footer))}</div>` : ""}
    <div class="bottom">${qr}<div class="sign">${sig?.imageUrl ? `<img src="${escapeHtml(sig.imageUrl)}" alt="Signature"/>` : `<div style="height:52px"></div>`}<div class="d">${escapeHtml(sig?.designation ?? "Principal")}</div>${sig?.name ? `<div>${escapeHtml(sig.name)}</div>` : ""}</div></div>
  </div></body></html>`;
}
