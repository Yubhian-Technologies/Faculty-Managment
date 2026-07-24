export interface PdfMargin {
  top: string;
  bottom: string;
  left: string;
  right: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Browser = any;

// On Vercel, full `puppeteer`'s bundled ~300MB desktop Chromium won't fit in (or run
// correctly in) a serverless function — so there we use `puppeteer-core` (no bundled
// browser) with `@sparticuz/chromium`, a Chromium build made for Lambda-style
// environments. Everywhere else (local dev, a real `next start` server) we use full
// `puppeteer`, whose bundled-browser download makes local setup a no-config `npm install`.
// See next.config.ts's `outputFileTracingIncludes` for the matching deploy-side config
// that ships @sparticuz/chromium's binary into the function bundle.
//
// `puppeteer`/`puppeteer-core` and `@sparticuz/chromium` are exact-pinned (no `^`) in
// package.json, not just here — @sparticuz/chromium always trails the latest Chromium
// by a release or two (it publishes a build for each major Chromium version some days
// after Google/Puppeteer ship it), so puppeteer-core's bundled Chrome revision and
// @sparticuz/chromium's revision drift out of sync easily. A caret range would let a
// routine `npm install`/`npm update` bump puppeteer-core ahead of whatever Chromium
// build @sparticuz/chromium currently ships, silently reintroducing a version
// mismatch. If bumping either, re-check both revisions match first (compare
// node_modules/puppeteer-core/lib/puppeteer/revisions.js's `chrome` value against the
// @sparticuz/chromium release notes at https://github.com/Sparticuz/chromium/releases).
async function launchBrowser(): Promise<Browser | null> {
  if (process.env.VERCEL) {
    try {
      const chromium = (await import("@sparticuz/chromium")).default;
      const puppeteerCore = (await import("puppeteer-core")).default;
      // Matches @sparticuz/chromium's documented usage exactly: `defaultArgs` merges
      // chromium's serverless-tuned flags with puppeteer-core's own required launch
      // args (e.g. remote-debugging setup) — passing `chromium.args` alone omits those
      // and can fail to establish the CDP connection. `headless: "shell"` is required
      // because this Chromium build doesn't support the "new" headless mode.
      return await puppeteerCore.launch({
        args: await puppeteerCore.defaultArgs({ args: chromium.args, headless: "shell" }),
        executablePath: await chromium.executablePath(),
        headless: "shell",
      });
    } catch (err) {
      console.error("[renderHtmlToPdf] serverless chromium launch failed", err);
      return null;
    }
  }

  // Dynamic import via variable so bundlers/tracers can't detect this dependency and
  // pull its bundled Chromium into a deployment trace (it's only ever used locally).
  const puppeteerPkg = "puppeteer";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const puppeteer = await (import(/* webpackIgnore: true */ puppeteerPkg) as Promise<any>).catch(() => null);
  if (!puppeteer) return null;
  return await puppeteer.default.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

// Returns null when no renderer is available at all. Callers should fall back to
// serving/attaching the raw HTML instead.
export async function renderHtmlToPdf(html: string, margin: PdfMargin): Promise<Buffer | null> {
  const browser = await launchBrowser();
  if (!browser) return null;

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
