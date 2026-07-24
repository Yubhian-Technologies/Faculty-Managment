export interface PdfMargin {
  top: string;
  bottom: string;
  left: string;
  right: string;
}

// Returns null when puppeteer isn't resolvable (e.g. Vercel, where it's optional-at-runtime —
// see AGENTS.md). Callers should fall back to serving/attaching the raw HTML instead.
export async function renderHtmlToPdf(html: string, margin: PdfMargin): Promise<Buffer | null> {
  // Dynamic import via variable to avoid static bundling
  const puppeteerPkg = "puppeteer";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const puppeteer = await (import(/* webpackIgnore: true */ puppeteerPkg) as Promise<any>).catch(() => null);
  if (!puppeteer) return null;

  const browser = await puppeteer.default.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    // A4 @ 96dpi — keeps the DOM layout width in sync with the printed page width so
    // content isn't laid out against Puppeteer's default 800x600 viewport and then
    // rescaled to fit A4 (the classic cause of PDFs rendering "shrunk" in a corner).
    await page.setViewport({ width: 794, height: 1123 });
    await page.setContent(html, { waitUntil: "networkidle0" });

    return await page.pdf({ format: "A4", printBackground: true, margin });
  } finally {
    await browser.close();
  }
}
