import { katexHtml, printableLatex } from "./renderMath";

// Formulas for the PDF. The PDF is a picture of an HTML page taken by
// html2canvas, which does not follow KaTeX's fine layout (stretchy brackets,
// fraction bars, limits drift out of place). So each formula is drawn by MathJax
// as a self-contained SVG (shapes, no fonts) and placed as an image, which
// html2canvas copies exactly. The screen keeps KaTeX. MathJax loads only here,
// when a PDF is downloaded. A formula MathJax can't draw falls back to KaTeX.

type Render = (latex: string, display: boolean) => string;

/** One ex of the PDF's maths, in px (the PDF text is 12px; maths a touch larger, like KaTeX). */
const EX_PX = 7;

async function loadMathJax() {
  const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, { AllPackages }] = await Promise.all([
    import("mathjax-full/js/mathjax.js"),
    import("mathjax-full/js/input/tex.js"),
    import("mathjax-full/js/output/svg.js"),
    import("mathjax-full/js/adaptors/liteAdaptor.js"),
    import("mathjax-full/js/handlers/html.js"),
    import("mathjax-full/js/input/tex/AllPackages.js"),
  ]);
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  // fontCache "none": every SVG carries its own glyph paths, so it works as a standalone image.
  const doc = mathjax.document("", { InputJax: new TeX({ packages: AllPackages }), OutputJax: new SVG({ fontCache: "none" }) });
  return (latex: string, display: boolean) => adaptor.innerHTML(doc.convert(latex, { display }) as never);
}

const exToPx = (v: string | undefined) => (v && /ex$/.test(v) ? `${(parseFloat(v) * EX_PX).toFixed(2)}px` : undefined);

/** The MathJax SVG as an <img>, sized in px and sitting on the text baseline. */
function svgImage(svg: string, display: boolean): string | null {
  const width = exToPx(/\swidth="([^"]+)"/.exec(svg)?.[1]);
  const height = exToPx(/\sheight="([^"]+)"/.exec(svg)?.[1]); // set on the SVG itself; the <img> keeps its ratio when it has to shrink
  if (!width || !height) return null;
  const valign = exToPx(/vertical-align:\s*([-\d.]+ex)/.exec(svg)?.[1]) ?? "0px";
  const sized = svg.replace(/\swidth="[^"]+"/, ` width="${width}"`).replace(/\sheight="[^"]+"/, ` height="${height}"`);
  const src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(sized)))}`;
  return display
    ? `<span class="mj-display"><img src="${src}" alt="" style="width:${width};max-width:100%;height:auto" /></span>`
    : `<img class="mj" src="${src}" alt="" style="width:${width};max-width:100%;height:auto;vertical-align:${valign}" />`;
}

/** A formula renderer for the PDF: MathJax SVG images, KaTeX for any it can't draw. */
export async function pdfFormulaRenderer(): Promise<Render> {
  let toSvg: ((latex: string, display: boolean) => string) | null = null;
  try { toSvg = await loadMathJax(); } catch (err) { console.error("[mid-bank pdf] MathJax failed to load", err); }
  const cache = new Map<string, string>();
  return (latex, display) => {
    const key = `${display ? "D" : "I"}${latex}`;
    const hit = cache.get(key);
    if (hit) return hit;
    let out: string | null = null;
    if (toSvg) {
      try { out = svgImage(toSvg(printableLatex(latex), display), display); } catch { out = null; }
    }
    out ??= katexHtml(latex, display);
    cache.set(key, out);
    return out;
  };
}
