import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { fetchCollegeLogoUrl } from "@/lib/pdf/logo";
import { getMidTimetableHTML, type MidTimetableSheetPrint } from "@/lib/pdf/midTimetableTemplate";

// The Mid timetable PDF: one A4 LANDSCAPE sheet like the college prints (the
// shared htmlToPdf is portrait-only, so this draws its own page). The sheet is
// scaled to the page width; a very tall one continues on further pages.

const W_MM = 297;
const H_MM = 210;

async function landscapePdf(html: string, fileName: string): Promise<void> {
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
    const canvas = await html2canvas(page, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
    const pxPerMm = canvas.width / W_MM;
    const pageH = Math.floor(H_MM * pxPerMm);
    for (let y = 0, first = true; y < canvas.height; y += pageH, first = false) {
      const h = Math.min(pageH, canvas.height - y);
      const slice = document.createElement("canvas");
      slice.width = canvas.width; slice.height = h;
      slice.getContext("2d")!.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (!first) pdf.addPage("a4", "landscape");
      pdf.addImage(slice.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, W_MM, h / pxPerMm);
    }
    pdf.save(fileName);
  } finally {
    holder.remove();
  }
}

/** One Mid's timetable sheet (all its branches, or just some) as a landscape PDF. */
export async function downloadMidTimetablePdf(sheet: MidTimetableSheetPrint, fileName: string): Promise<void> {
  const [info, logoUrl] = await Promise.all([
    fetch("/api/college/info").then((r) => (r.ok ? r.json() : {})).catch(() => ({})) as Promise<{ name?: string; affiliation?: string; address?: string }>,
    fetchCollegeLogoUrl(),
  ]);
  const html = getMidTimetableHTML({ college: { name: info.name || "College", affiliation: info.affiliation, address: info.address, logoUrl }, sheet });
  await landscapePdf(html, `${fileName.replace(/[^a-zA-Z0-9-_]+/g, "-")}.pdf`);
}
