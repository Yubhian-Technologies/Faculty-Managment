import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { fetchCollegeLogoUrl } from "@/lib/pdf/logo";
import { getBranchTimetableHTML, getMidTimetableHTML, splitBySession, type MidTimetableSheetPrint } from "@/lib/pdf/midTimetableTemplate";

// The Mid timetable PDF: one A4 LANDSCAPE sheet like the college prints (the
// shared htmlToPdf is portrait-only, so this draws its own page). The sheet is
// scaled to the page width; a very tall one continues on further pages.

const W_MM = 297;
const H_MM = 210;

/** One HTML document drawn to a canvas, A4-landscape wide. */
async function toCanvas(html: string): Promise<HTMLCanvasElement> {
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;top:0;left:-10000px;z-index:-1";
  const iframe = document.createElement("iframe");
  iframe.style.cssText = `width:${W_MM}mm;border:none`;
  holder.appendChild(iframe);
  document.body.appendChild(holder);
  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Could not prepare the PDF");
    doc.open(); doc.write(html); doc.close();
    await Promise.all(Array.from(doc.images).map((img) => (img.complete ? Promise.resolve() : new Promise<void>((r) => { img.onload = img.onerror = () => r(); }))));
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const page = (doc.querySelector(".page") as HTMLElement | null) ?? doc.body;
    iframe.style.height = `${page.scrollHeight}px`;
    return await html2canvas(page, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
  } finally {
    holder.remove();
  }
}

/** Each document from a new landscape page. A document up to ~1.6 pages tall is shrunk onto one (a timetable reads best whole). */
async function landscapePdf(htmls: string[], fileName: string): Promise<void> {
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  let first = true;
  const newPage = () => { if (!first) pdf.addPage("a4", "landscape"); first = false; };
  for (const html of htmls) {
    const canvas = await toCanvas(html);
    const pxPerMm = canvas.width / W_MM;
    const heightMm = canvas.height / pxPerMm;
    if (heightMm <= H_MM * 1.6) {
      const k = Math.min(1, H_MM / heightMm);
      newPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", (W_MM - W_MM * k) / 2, 0, W_MM * k, heightMm * k);
      continue;
    }
    const pageH = Math.floor(H_MM * pxPerMm);
    for (let y = 0; y < canvas.height; y += pageH) {
      const h = Math.min(pageH, canvas.height - y);
      const slice = document.createElement("canvas");
      slice.width = canvas.width; slice.height = h;
      slice.getContext("2d")!.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      newPage();
      pdf.addImage(slice.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, W_MM, h / pxPerMm);
    }
  }
  pdf.save(fileName);
}

/**
 * A Mid timetable as a landscape PDF: `sheet` = the combined sheet (branches x
 * days); `sessions` = one sheet per session (Morning, Afternoon ...) with the
 * branches writing then; `branches` = one branch's own timetable (Date, Day, Time,
 * Subject) - what students get.
 */
export async function downloadMidTimetablePdf(sheet: MidTimetableSheetPrint, fileName: string, mode: "sheet" | "branches" | "sessions" = "sheet"): Promise<void> {
  const [info, logoUrl] = await Promise.all([
    fetch("/api/college/info").then((r) => (r.ok ? r.json() : {})).catch(() => ({})) as Promise<{ name?: string; affiliation?: string; address?: string; academicYear?: string }>,
    fetchCollegeLogoUrl(),
  ]);
  const college = { name: info.name || "College", affiliation: info.affiliation, address: info.address, logoUrl };
  sheet = { ...sheet, academicYear: sheet.academicYear ?? info.academicYear };
  const htmls = mode === "branches"
    ? sheet.rows.filter((r) => r.slots.length).map((row) => getBranchTimetableHTML({ college, sheet, row }))
    : mode === "sessions" ? splitBySession(sheet).map((s) => getMidTimetableHTML({ college, sheet: s }))
    : [getMidTimetableHTML({ college, sheet })];
  if (htmls.length === 0) throw new Error("Nothing to print");
  await landscapePdf(htmls, `${fileName.replace(/[^a-zA-Z0-9-_]+/g, "-")}.pdf`);
}
