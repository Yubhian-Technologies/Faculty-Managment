// Converts a print-ready HTML document (as produced by src/lib/pdf/*Template.ts)
// into a real, multi-page A4 PDF entirely in the browser - no headless-Chrome
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
const RENDER_SCALE = 2; // canvas px per CSS px - crisp text at print resolution

// .doc-link must stay atomic too: a page break landing inside it would visually
// split "View Certificate ↗" across two pages, and - worse - extractLinkAnnotations
// assigns the whole <a>'s bounding rect to a single page, so a straddling link
// gets a corrupted (out-of-bounds) /Rect and stops being clickable entirely.
const ATOMIC_SELECTOR = ".entry, .bullets li, table.data-table tr, .fitem, .section-title, .subheading, .doc-link";

// Plain body copy (letter paragraphs, numbered terms-and-conditions clauses,
// table cells) isn't a single-line atom like the selector above - a <p> can
// wrap across many lines, and only the *line currently sitting on the break*
// needs protecting, not the whole paragraph. Without this, a proposed break
// landing inside a wrapped line sliced the canvas mid-glyph: the tail of a
// sentence at the bottom of one page, its head at the top of the next.
const LINE_TEXT_SELECTOR = "p, li, td, th";

// A whole `.section` (heading + body, see resumeTemplate's renderSection) that
// fits on one page is kept together: if a page break would land inside it, the
// break moves up to just before the section instead, so a short section is
// never split across two pages. A section too tall for any single page still
// has to split - it does so only between entries/rows (the atomic elements
// above), and a split table repeats its header row on the next page.
const SECTION_SELECTOR = ".section";

/** Per-rendered-line ranges (not per-element) for LINE_TEXT_SELECTOR elements,
 *  via Range.getClientRects() - one rect per wrapped line, so a page break can
 *  be pulled back to just before the line it would otherwise cut through. */
function lineRanges(container: HTMLElement): { top: number; bottom: number }[] {
  const originTop = container.getBoundingClientRect().top;
  const doc = container.ownerDocument;
  const ranges: { top: number; bottom: number }[] = [];
  for (const el of Array.from(container.querySelectorAll<HTMLElement>(LINE_TEXT_SELECTOR))) {
    const range = doc.createRange();
    range.selectNodeContents(el);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.height === 0) continue;
      ranges.push({ top: (rect.top - originTop) * RENDER_SCALE, bottom: (rect.bottom - originTop) * RENDER_SCALE });
    }
  }
  return ranges;
}

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

/** Bakes an `object-fit: cover` center-crop into the pixel data itself, at
 *  `targetWidth`x`targetHeight` (device pixels). html2canvas never implements
 *  `object-fit` (it just draws the raw image into the element's box), so a
 *  non-square source photo would otherwise render squashed/stretched instead of
 *  cropped - this makes the image itself already the right aspect ratio, so
 *  there's nothing left for html2canvas to get wrong. */
async function cropToCover(blob: Blob, targetWidth: number, targetHeight: number): Promise<string> {
  const width = Math.max(1, Math.round(targetWidth));
  const height = Math.max(1, Math.round(targetHeight));
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return blobToDataUrl(blob);

    const targetRatio = width / height;
    const sourceRatio = bitmap.width / bitmap.height;
    let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height;
    if (sourceRatio > targetRatio) {
      sw = bitmap.height * targetRatio;
      sx = (bitmap.width - sw) / 2;
    } else if (sourceRatio < targetRatio) {
      sh = bitmap.width / targetRatio;
      sy = (bitmap.height - sh) / 2;
    }
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.92);
  } finally {
    bitmap.close();
  }
}

// Firebase Storage profile photos have no CORS policy for this app's origin -
// html2canvas can't read their pixel data cross-origin (the HTTP fetch succeeds,
// but the browser blocks JS from using the response), so it silently drops them
// from the capture. Routing through our own same-origin proxy and inlining as a
// data: URI sidesteps CORS entirely, instead of depending on Storage bucket config.
// Along the way, any image styled with `object-fit: cover` (e.g. the avatar) gets
// pre-cropped to its rendered box's aspect ratio - see cropToCover above.
async function inlineCrossOriginImages(doc: Document): Promise<void> {
  const imgs = Array.from(doc.images).filter((img) => img.src.startsWith("https://firebasestorage.googleapis.com/"));
  await Promise.all(
    imgs.map(async (img) => {
      try {
        const res = await fetch(`/api/pdf/image-proxy?url=${encodeURIComponent(img.src)}`);
        if (!res.ok) return;
        const blob = await res.blob();
        const rect = img.getBoundingClientRect();
        const isCover = (doc.defaultView ?? window).getComputedStyle(img).objectFit === "cover" && rect.width > 0 && rect.height > 0;
        img.src = isCover
          ? await cropToCover(blob, rect.width * RENDER_SCALE, rect.height * RENDER_SCALE)
          : await blobToDataUrl(blob);
      } catch {
        // Leave the original (cross-origin) src - html2canvas will just skip it as before.
      }
    })
  );
}

type Range1D = { top: number; bottom: number };

/** Bottom (canvas px) of the first thing that must stay on the same page as
 *  the heading `el` directly above it - so a heading is never stranded alone
 *  at the foot of a page. For a table that is the header row plus the first
 *  data row; for a stacked heading (section title straight above a
 *  subheading) it chains to what follows that one. */
function leadBottom(el: HTMLElement, originTop: number): number {
  const rectBottom = (e: Element) => (e.getBoundingClientRect().bottom - originTop) * RENDER_SCALE;
  const next = el.nextElementSibling as HTMLElement | null;
  if (!next) return rectBottom(el);
  if (next.matches(".subheading")) return leadBottom(next, originTop);
  if (next.matches("table")) {
    const rows = next.querySelectorAll("tr");
    return rectBottom(rows[Math.min(1, rows.length - 1)] ?? next);
  }
  const unit = next.matches(ATOMIC_SELECTOR) ? next : next.querySelector<HTMLElement>(ATOMIC_SELECTOR);
  if (unit) return rectBottom(unit);
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(next);
  const first = Array.from(range.getClientRects()).find((r) => r.height > 0);
  return first ? (first.bottom - originTop) * RENDER_SCALE : rectBottom(next);
}

/** Canvas-pixel [top, bottom] ranges a page break must not land inside, sorted
 *  by top: every atomic element, every wrapped text line, each heading together
 *  with its first piece of content, and every section short enough to fit on
 *  one page whole. */
function atomicRanges(container: HTMLElement, pageHeightPx: number): Range1D[] {
  const originTop = container.getBoundingClientRect().top;
  const ranges: Range1D[] = Array.from(container.querySelectorAll<HTMLElement>(ATOMIC_SELECTOR)).map((el) => {
    const rect = el.getBoundingClientRect();
    return { top: (rect.top - originTop) * RENDER_SCALE, bottom: (rect.bottom - originTop) * RENDER_SCALE };
  });
  for (const el of Array.from(container.querySelectorAll<HTMLElement>(".section-title, .subheading"))) {
    const top = (el.getBoundingClientRect().top - originTop) * RENDER_SCALE;
    ranges.push({ top, bottom: Math.max(top, leadBottom(el, originTop)) });
  }
  for (const el of Array.from(container.querySelectorAll<HTMLElement>(SECTION_SELECTOR))) {
    const rect = el.getBoundingClientRect();
    const top = (rect.top - originTop) * RENDER_SCALE;
    const bottom = (rect.bottom - originTop) * RENDER_SCALE;
    if (bottom - top <= pageHeightPx) ranges.push({ top, bottom });
  }
  ranges.push(...lineRanges(container));
  ranges.sort((a, b) => a.top - b.top);
  return ranges;
}

interface PdfLinkAnnotation {
  pageIndex: number;
  x: number; y: number; w: number; h: number; // all in mm, relative to page top-left
  url: string;
}

/** Walks every <a href> inside `container` and maps their rendered bounding
 *  rectangles to PDF page coordinates (mm) so jsPDF can stamp invisible
 *  clickable annotations on top of the rasterized JPEG pages.
 *
 *  Must be called while the container is still in the DOM (after html2canvas
 *  capture but before the container is removed from the document). */
function extractLinkAnnotations(
  container: HTMLElement,
  pxPerMm: number,
  breaks: number[],
): PdfLinkAnnotation[] {
  const origin = container.getBoundingClientRect();
  const annotations: PdfLinkAnnotation[] = [];

  for (const a of Array.from(container.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = a.getAttribute("href");
    if (!href || !href.startsWith("http")) continue;

    const rect = a.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    // Canvas-pixel coords relative to the page container
    const topPx  = (rect.top  - origin.top)  * RENDER_SCALE;
    const leftPx = (rect.left - origin.left) * RENDER_SCALE;
    const wPx    = rect.width  * RENDER_SCALE;
    const hPx    = rect.height * RENDER_SCALE;

    // Which PDF page does this link's top edge fall on?
    let pageIndex = 0;
    let pageStartPx = 0;
    for (let i = 0; i < breaks.length; i++) {
      const start = i === 0 ? 0 : breaks[i - 1];
      if (topPx >= start && topPx < breaks[i]) {
        pageIndex   = i;
        pageStartPx = start;
        break;
      }
    }

    annotations.push({
      pageIndex,
      x: leftPx / pxPerMm,
      y: (topPx - pageStartPx) / pxPerMm,
      w: wPx / pxPerMm,
      h: hPx / pxPerMm,
      url: href,
    });
  }

  return annotations;
}

/** Walks forward in page-height increments, pulling each proposed break back to
 *  just before any range it would otherwise cut through - the outermost one
 *  that starts on this page, repeated until nothing straddles it. Falls back to
 *  cutting anyway if a single element is taller than a full page. */
function computePageBreaks(totalHeight: number, pageHeight: number, ranges: Range1D[]): number[] {
  const breaks: number[] = [];
  let cursor = 0;
  while (cursor < totalHeight) {
    let proposed = Math.min(cursor + pageHeight, totalHeight);
    if (proposed < totalHeight) {
      for (;;) {
        const at = proposed;
        const straddling = ranges.filter((r) => r.top < at && r.bottom > at && r.top > cursor);
        if (straddling.length === 0) break;
        proposed = Math.min(...straddling.map((r) => r.top));
      }
    }
    if (proposed <= cursor) proposed = Math.min(cursor + pageHeight, totalHeight); // unavoidable oversized element
    breaks.push(proposed);
    cursor = proposed;
  }
  return breaks;
}

/** A table that continues onto another page gets its header row repeated at
 *  the top of that page, so a reader of page 2 still knows what each column is.
 *
 *  Inserting a header row shifts everything below it, which can move the page
 *  breaks, so this iterates: lay out with the headers placed so far, find where
 *  the breaks now fall, and re-place headers - until the placement stops
 *  changing (it settles within a couple of passes; capped as a safety net). */
function repeatTableHeaders(target: HTMLElement, pageHeightPx: number): void {
  const originTop = () => target.getBoundingClientRect().top;
  const headerOf = (table: HTMLTableElement): HTMLTableRowElement | null => {
    const first = table.querySelector<HTMLTableRowElement>("tr:not(.repeat-head)");
    return first && first.querySelector("th") ? first : null;
  };

  let applied = new Set<HTMLTableRowElement>(); // data rows that currently have a header clone inserted above them
  for (let pass = 0; pass < 8; pass++) {
    target.querySelectorAll("tr.repeat-head").forEach((r) => r.remove());
    for (const row of applied) {
      const header = headerOf(row.closest("table") as HTMLTableElement);
      if (!header) continue;
      const clone = header.cloneNode(true) as HTMLTableRowElement;
      clone.classList.add("repeat-head");
      row.parentNode?.insertBefore(clone, row);
    }

    const total = target.getBoundingClientRect().height * RENDER_SCALE;
    const breaks = computePageBreaks(total, pageHeightPx, atomicRanges(target, pageHeightPx)).slice(0, -1);
    const wanted = new Set<HTMLTableRowElement>();
    const top0 = originTop();
    for (const at of breaks) {
      for (const table of Array.from(target.querySelectorAll<HTMLTableElement>("table.data-table"))) {
        const header = headerOf(table);
        if (!header) continue;
        const rect = table.getBoundingClientRect();
        if (!((rect.top - top0) * RENDER_SCALE < at && (rect.bottom - top0) * RENDER_SCALE > at)) continue;
        // First real data row at or below the break (skipping the header and any clones).
        const next = Array.from(table.querySelectorAll<HTMLTableRowElement>("tr:not(.repeat-head)")).find(
          (r) => r !== header && (r.getBoundingClientRect().top - top0) * RENDER_SCALE >= at - 1
        );
        if (next) wanted.add(next);
      }
    }
    const same = wanted.size === applied.size && Array.from(wanted).every((r) => applied.has(r));
    applied = wanted;
    if (same) return;
  }
  // Not settled within the cap: leave the last placement in the DOM and carry on.
  target.querySelectorAll("tr.repeat-head").forEach((r) => r.remove());
  for (const row of applied) {
    const header = headerOf(row.closest("table") as HTMLTableElement);
    if (!header) continue;
    const clone = header.cloneNode(true) as HTMLTableRowElement;
    clone.classList.add("repeat-head");
    row.parentNode?.insertBefore(clone, row);
  }
}

/** Renders `html` off-screen, captures it as a canvas, and slices it into A4
 *  pages inside a jsPDF document. Shared core for both renderHtmlToPdf (saves
 *  to disk) and renderHtmlToPdfBlob (returns bytes, e.g. to attach to an email) —
 *  keep any future changes to the rendering pipeline in this one place. */
async function renderHtmlToPdfDocument(html: string): Promise<jsPDF> {
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

    // Page geometry in CSS px (the template is a fixed 210mm-wide column).
    // Measured with getBoundingClientRect, not scrollHeight, so a fractional
    // height is rounded UP rather than down - rounding down shaved the last
    // line (the footer) off the final page.
    const widthCss = Math.ceil(target.getBoundingClientRect().width);
    const pxPerMm = (widthCss * RENDER_SCALE) / A4_WIDTH_MM;
    const pageHeightPx = A4_HEIGHT_MM * pxPerMm;

    // Repeat table headers on continuation pages BEFORE measuring the final
    // layout (it inserts rows, so the height and break positions change).
    repeatTableHeaders(target, pageHeightPx);
    const totalCss = Math.ceil(target.getBoundingClientRect().height);
    iframe.style.height = `${totalCss + 40}px`;

    // Canvas-px (CSS px x RENDER_SCALE) geometry, as the break helpers expect.
    const totalHeight = totalCss * RENDER_SCALE;
    const breaks = computePageBreaks(totalHeight, pageHeightPx, atomicRanges(target, pageHeightPx));

    // Extract link positions while the iframe is still in the DOM - before
    // the finally block removes it.
    const linkAnnotations = extractLinkAnnotations(target, pxPerMm, breaks);

    // Each page is captured on its OWN small canvas (html2canvas crops to the
    // y/height window) instead of rasterising the whole document once and
    // slicing it. One canvas for a long resume gets enormous (width x scale x
    // total height), and browsers cap canvas size - iOS Safari and many
    // Android browsers at ~16.7M pixels, i.e. only a few pages - so a long
    // resume came out blank/truncated past that point. A single page is always
    // well inside every browser's limit, so the full document is always kept.
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    let cursor = 0;
    for (let i = 0; i < breaks.length; i++) {
      const breakAt = breaks[i];
      const sliceHeightPx = Math.max(1, Math.round(breakAt - cursor));
      const canvas = await html2canvas(target, {
        scale: RENDER_SCALE,
        useCORS: true,
        backgroundColor: "#ffffff",
        x: 0,
        y: cursor / RENDER_SCALE,
        width: widthCss,
        height: sliceHeightPx / RENDER_SCALE,
        windowWidth: widthCss,
        windowHeight: totalCss,
        scrollX: 0,
        scrollY: 0,
      });
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, 0, A4_WIDTH_MM, sliceHeightPx / pxPerMm);

      // Stamp invisible clickable hyperlink rectangles over each link on this page
      for (const ann of linkAnnotations) {
        if (ann.pageIndex === i) {
          pdf.link(ann.x, ann.y, ann.w, ann.h, { url: ann.url });
        }
      }

      cursor = breakAt;
    }

    return pdf;
  } finally {
    document.body.removeChild(container);
  }
}

/** Renders `html` to a PDF and saves it to disk as `filename` (should end in .pdf). */
export async function renderHtmlToPdf(html: string, filename: string): Promise<void> {
  const pdf = await renderHtmlToPdfDocument(html);
  pdf.save(filename);
}

/** Renders `html` to a PDF and returns the raw bytes as a Blob — e.g. to attach
 *  to an outgoing email instead of downloading it to the browser. */
export async function renderHtmlToPdfBlob(html: string): Promise<Blob> {
  const pdf = await renderHtmlToPdfDocument(html);
  return pdf.output("blob");
}
