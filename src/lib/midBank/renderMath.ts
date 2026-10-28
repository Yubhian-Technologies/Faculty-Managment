import katex from "katex";

// Question text -> safe HTML: plain text is escaped, formulas between $...$
// (inline) or $$...$$ (display) are rendered by KaTeX, line breaks kept.
// Used by the editor preview, the review screen and the PDF, so all three
// show a formula the same way. A formula KaTeX can't read is shown in red
// rather than throwing.

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A question's text cut into plain text and formulas, with each piece's place in the text. */
export type MathSegment =
  | { kind: "text"; text: string; start: number; end: number }
  | { kind: "math"; latex: string; display: boolean; start: number; end: number };

export function splitMath(text: string): MathSegment[] {
  const out: MathSegment[] = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index), start: last, end: m.index });
    const display = m[1] !== undefined;
    out.push({ kind: "math", latex: (display ? m[1] : m[2]).trim(), display, start: m.index, end: m.index + m[0].length });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last), start: last, end: text.length });
  return out;
}

/** How a formula sits in the text: $...$ inside a sentence, $$...$$ on its own line. */
export const formulaToken = (latex: string, display: boolean) => (display ? `$$${latex}$$` : `$${latex}$`);

/** MathLive's empty box (`\placeholder{}` / `\placeholder[id]{value}`) - KaTeX doesn't know it. */
const PLACEHOLDER = /\\placeholder(?:\[[^\]]*\])?\{([^{}]*)\}/g;
export const hasEmptyBox = (text: string) => /\\placeholder\b/.test(text);
/** An empty box prints as a square (so it is visible), a filled one as its value. */
const withoutPlaceholders = (latex: string) => latex.replace(PLACEHOLDER, (_m, v: string) => (v.trim() ? v : "\\square "));

/**
 * MathLive's own spellings that KaTeX refuses, rewritten to the standard form:
 * a sized delimiter with its delimiter in braces (`\bigm{.}`, `\Bigl{(}`, `\left{|}`)
 * -> `\bigm.` / `\Bigl(` / `\left|`.
 */
export const normalizeLatex = (latex: string) =>
  latex.replace(/\\(big|Big|bigg|Bigg|left|right)([lmr]?)\s*\{\s*(\\[a-zA-Z]+|\\\S|[^{}\s\\])\s*\}/g, (_m, size: string, side: string, d: string) =>
    `\\${size}${side}${/^\\[a-zA-Z]+$/.test(d) ? `${d} ` : d}`);

const katexOptions = (display: boolean) => ({ displayMode: display, output: "html" as const, strict: "ignore" as const, trust: false });

/** The LaTeX as it is printed: MathLive spellings fixed, empty boxes as squares. */
export const printableLatex = (latex: string) => withoutPlaceholders(normalizeLatex(latex));

/** One formula as KaTeX HTML (a formula KaTeX can't read is shown in red, never thrown). */
export const katexHtml = (latex: string, display: boolean) =>
  katex.renderToString(printableLatex(latex), { ...katexOptions(display), throwOnError: false });

/** Why a formula can't be printed ("" = it can) - checked before it goes into a question. */
export function formulaProblem(latex: string): string {
  if (hasEmptyBox(latex)) return "Some boxes in the formula are still empty - fill them, or delete the ones you don't need.";
  try {
    katex.renderToString(normalizeLatex(latex), { ...katexOptions(false), throwOnError: true });
    return "";
  } catch {
    return "This formula can't be printed as it is - delete the last part you added and try another way of writing it.";
  }
}

/** Text with its formulas rendered: KaTeX by default, or `formula` (the PDF passes MathJax SVG images). */
export function renderMathHtml(text: string, formula: (latex: string, display: boolean) => string = katexHtml): string {
  return splitMath(text).map((s) => (s.kind === "text" ? escapeHtml(s.text).replace(/\n/g, "<br/>") : formula(s.latex, s.display))).join("");
}
