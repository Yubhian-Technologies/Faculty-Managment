import katex from "katex";

// Question text -> safe HTML: plain text is escaped, formulas between $...$
// (inline) or $$...$$ (display) are rendered by KaTeX, line breaks kept.
// Used by the editor preview, the review screen and the PDF, so all three
// show a formula the same way. A formula KaTeX can't read is shown in red
// rather than throwing.

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderMathHtml(text: string): string {
  const out: string[] = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push(escapeHtml(text.slice(last, m.index)).replace(/\n/g, "<br/>"));
    const display = m[1] !== undefined;
    out.push(katex.renderToString((display ? m[1] : m[2]).trim(), { displayMode: display, throwOnError: false, output: "html", strict: "ignore", trust: false }));
    last = m.index + m[0].length;
  }
  out.push(escapeHtml(text.slice(last)).replace(/\n/g, "<br/>"));
  return out.join("");
}

/** Snippets for the formula toolbar: label, what is inserted, and where the cursor lands (offset from the start). */
export const FORMULA_SNIPPETS: { label: string; insert: string; cursor: number; title: string }[] = [
  { label: "$x$", insert: "$ $", cursor: 1, title: "Inline formula" },
  { label: "x²", insert: "^{}", cursor: 2, title: "Power / superscript" },
  { label: "xᵢ", insert: "_{}", cursor: 2, title: "Subscript" },
  { label: "a/b", insert: "\\frac{}{}", cursor: 6, title: "Fraction" },
  { label: "√", insert: "\\sqrt{}", cursor: 6, title: "Square root" },
  { label: "∫", insert: "\\int_{}^{} ", cursor: 6, title: "Integral" },
  { label: "Σ", insert: "\\sum_{}^{} ", cursor: 6, title: "Sum" },
  { label: "lim", insert: "\\lim_{x \\to } ", cursor: 13, title: "Limit" },
  { label: "α", insert: "\\alpha ", cursor: 7, title: "Alpha" },
  { label: "θ", insert: "\\theta ", cursor: 7, title: "Theta" },
  { label: "π", insert: "\\pi ", cursor: 4, title: "Pi" },
  { label: "≤", insert: "\\le ", cursor: 4, title: "Less than or equal" },
  { label: "≥", insert: "\\ge ", cursor: 4, title: "Greater than or equal" },
  { label: "×", insert: "\\times ", cursor: 7, title: "Multiply" },
  { label: "→", insert: "\\rightarrow ", cursor: 12, title: "Arrow" },
  { label: "∞", insert: "\\infty ", cursor: 7, title: "Infinity" },
];
