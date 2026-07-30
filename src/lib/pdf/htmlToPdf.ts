// Converts a print-ready HTML document (as produced by src/lib/pdf/*Template.ts)
// into a real, multi-page A4 PDF entirely in the browser — no headless-Chrome
// dependency on the server (see AGENTS.md's PDF generation notes: puppeteer is
// deliberately not a server dependency here so this works on any serverless host).
//
// html2canvas/jsPDF paginate by raw pixel height, which would happily slice a
// canvas mid-table-row or mid-bullet. To avoid that, every element the template
// already marks with a `break-inside: avoid-page` / `break-after: avoid-page`
// CSS hint (entries, bullet lines, table rows, fact-grid items, section titles)
// is treated as atomic: a page break is pushed up to just before any such
// element that would otherwise straddle it.
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const RENDER_SCALE = 2; // canvas px per CSS px — crisp text at print resolution

const ATOMIC_SELECTOR = ".entry, .bullets li, table.data-table tr, .fitem, .section-title, .subheading";

function waitForImages(doc: Document): Promise<void> {
  const imgs = Array.from(doc.images);
  if (imgs.length === 0) return Promise.resolve();
  return Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve());
            img.addEventListener("error", () => resolve());
          })
    )
  ).then(() => undefined);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Firebase Storage profile photos have no CORS policy for this app's origin —
// html2canvas can't read their pixel data cross-origin (the HTTP fetch succeeds,
// but the browser blocks JS from using the response), so it silently drops them
// from the capture. Routing through our own same-origin proxy and inlining as a
// data: URI sidesteps CORS entirely, instead of depending on Storage bucket config.
async function inlineCrossOriginImages(doc: Document): Promise<void> {
  const imgs = Array.from(doc.images).filter((img) => img.src.startsWith("https://firebasestorage.googleapis.com/"));
  await Promise.all(
    imgs.map(async (img) => {
      try {
        const res = await fetch(`/api/pdf/image-proxy?url=${encodeURIComponent(img.src)}`);
        if (!res.ok) return;
        img.src = await blobToDataUrl(await res.blob());
      } catch {
        // Leave the original (cross-origin) src — html2canvas will just skip it as before.
      }
    })
  );
}

/** Canvas-pixel [top, bottom] ranges for every atomic element, sorted by top —
 *  used to nudge page-break offsets so they never land inside one of them. */
function atomicRanges(container: HTMLElement): { top: number; bottom: number }[] {
  const originTop = container.getBoundingClientRect().top;
  const ranges = Array.from(container.querySelectorAll<HTMLElement>(ATOMIC_SELECTOR)).map((el) => {
    const rect = el.getBoundingClientRect();
    return { top: (rect.top - originTop) * RENDER_SCALE, bottom: (rect.bottom - originTop) * RENDER_SCALE };
  });
  ranges.sort((a, b) => a.top - b.top);
  return ranges;
}

/** Walks forward in page-height increments, pulling each proposed break back to
 *  just before any atomic element it would otherwise cut through. Falls back to
 *  cutting anyway if a single element is taller than a full page. */
function computePageBreaks(totalHeight: number, pageHeight: number, ranges: { top: number; bottom: number }[]): number[] {
  const breaks: number[] = [];
  let cursor = 0;
  while (cursor < totalHeight) {
    let proposed = Math.min(cursor + pageHeight, totalHeight);
    if (proposed < totalHeight) {
      const straddling = ranges.find((r) => r.top < proposed && r.bottom > proposed);
      if (straddling && straddling.top > cursor) {
        proposed = straddling.top;
      }
    }
    if (proposed <= cursor) proposed = Math.min(cursor + pageHeight, totalHeight); // unavoidable oversized element
    breaks.push(proposed);
    cursor = proposed;
  }
  return breaks;
}

/** Renders `html` off-screen, captures it as a canvas, and slices it into A4
 *  pages inside a jsPDF document saved as `filename` (should end in .pdf). */
export async function renderHtmlToPdf(html: string, filename: string): Promise<void> {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "-10000px";
  container.style.zIndex = "-1";
  document.body.appendChild(container);

  const iframe = document.createElement("iframe");
  iframe.style.width = "210mm";
  iframe.style.border = "none";
  container.appendChild(iframe);

  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Could not prepare the document for PDF rendering.");
    doc.open();
    doc.write(html);
    doc.close();

    await inlineCrossOriginImages(doc);
    await waitForImages(doc);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

    const target = (doc.querySelector(".page") as HTMLElement | null) ?? doc.body;
    iframe.style.height = `${target.scrollHeight}px`;

    const canvas = await html2canvas(target, {
      scale: RENDER_SCALE,
      useCORS: true,
      backgroundColor: "#ffffff",
      windowWidth: target.scrollWidth,
      windowHeight: target.scrollHeight,
    });

    const pxPerMm = canvas.width / A4_WIDTH_MM;
    const pageHeightPx = A4_HEIGHT_MM * pxPerMm;
    const ranges = atomicRanges(target);
    const breaks = computePageBreaks(canvas.height, pageHeightPx, ranges);

    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    let cursor = 0;
    breaks.forEach((breakAt, i) => {
      const sliceHeight = Math.max(1, Math.round(breakAt - cursor));
      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = sliceHeight;
      const ctx = sliceCanvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(canvas, 0, cursor, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
      }
      const imgData = sliceCanvas.toDataURL("image/jpeg", 0.95);
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, 0, A4_WIDTH_MM, sliceHeight / pxPerMm);
      cursor = breakAt;
    });

    pdf.save(filename);
  } finally {
    document.body.removeChild(container);
  }
}
