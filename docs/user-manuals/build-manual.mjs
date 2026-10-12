// Builds a user-manual PDF from its HTML source, and renders every page to a
// PNG so the finished document can be inspected visually.
//
// Chromium comes from @playwright/test, already a dev dependency of this repo -
// nothing new is installed, and no application code is touched.
//
//   node docs/user-manuals/build-manual.mjs class-representative-user-manual
//   node docs/user-manuals/build-manual.mjs <name> --no-shots
//
// The HTML lays each page out as an explicit 210x297mm block, so pagination is
// decided by the document rather than by the renderer. `preferCSSPageSize`
// keeps Chromium from re-flowing it.

import { chromium } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { mkdir, readdir, rm, stat } from "node:fs/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2];
const withShots = !process.argv.includes("--no-shots");

if (!name) {
  console.error("usage: node build-manual.mjs <manual-name> [--no-shots]");
  process.exit(1);
}

const htmlPath = join(HERE, `${name}.html`);
const pdfPath = join(HERE, `${name}.pdf`);
const shotDir = join(HERE, "assets", `${name}-pages`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });

await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });

const pageCount = await page.locator("section.page").count();

await page.pdf({
  path: pdfPath,
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: "0", right: "0", bottom: "0", left: "0" },
});

const { size } = await stat(pdfPath);
console.log(`PDF   ${pdfPath}`);
console.log(`      ${pageCount} pages, ${(size / 1024).toFixed(0)} KB`);

if (withShots) {
  await rm(shotDir, { recursive: true, force: true });
  await mkdir(shotDir, { recursive: true });
  // Screen styling adds a drop shadow and gap between sheets; strip it so each
  // capture is exactly the printed page.
  await page.addStyleTag({ content: ".page{margin:0 !important;box-shadow:none !important}body{background:#fff}" });
  for (let i = 0; i < pageCount; i++) {
    const n = String(i + 1).padStart(2, "0");
    await page.locator("section.page").nth(i).screenshot({ path: join(shotDir, `page-${n}.png`) });
  }
  const shots = (await readdir(shotDir)).filter((f) => f.endsWith(".png"));
  console.log(`PNG   ${shotDir}`);
  console.log(`      ${shots.length} page images for visual review`);
}

await browser.close();
