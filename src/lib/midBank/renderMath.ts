import katex from "katex";

// Question text -> safe HTML: plain text is escaped, formulas between $...$
// (inline) or $$...$$ (display) are rendered by KaTeX, line breaks kept.
// Used by the editor preview, the review screen and the PDF, so all three
// show a formula the same way. A formula KaTeX can't read is shown in red
// rather than throwing.

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

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

/** One formula as KaTeX HTML (a formula KaTeX can't read is shown in red, never thrown). */
export const katexHtml = (latex: string, display: boolean) =>
  katex.renderToString(withoutPlaceholders(latex), { displayMode: display, throwOnError: false, output: "html", strict: "ignore", trust: false });

export function renderMathHtml(text: string): string {
  return splitMath(text).map((s) => (s.kind === "text" ? escapeHtml(s.text).replace(/\n/g, "<br/>") : katexHtml(s.latex, s.display))).join("");
}
