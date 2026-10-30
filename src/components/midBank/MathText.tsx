"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import "katex/dist/katex.min.css";
import { Sigma } from "lucide-react";
import { Button } from "@/components/ui/button";
import { escapeHtml, formulaToken, katexHtml, renderMathHtml, splitMath } from "@/lib/midBank/renderMath";
import { FormulaPanel } from "./FormulaPanel";

/** Question text with its $...$ formulas rendered (text is escaped - see renderMathHtml). */
export function MathText({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => renderMathHtml(text), [text]);
  return <div className={`[overflow-wrap:anywhere] ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * The question box: one editor where the text is typed as usual and each formula
 * sits inside it already typeset (as it will print). "Formula" opens the visual
 * formula pop-up and inserts it where the cursor was; clicking a formula opens it
 * for editing (Update / Remove). The value is still plain text with $...$ LaTeX,
 * so the review and PDF are unchanged. Faculty never see or type LaTeX.
 */
export function QuestionTextField({ id, value, onChange, placeholder, invalid, describedBy, disabled }: {
  id: string; value: string; onChange: (v: string) => void; placeholder?: string; invalid?: boolean; describedBy?: string; disabled?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null); // the value the box's content stands for
  const saved = useRef<Range | null>(null); // where a new formula goes
  // null = closed; "new" = insert at the saved cursor; an element = that formula being edited.
  const [panel, setPanel] = useState<null | { mode: "new" } | { mode: "edit"; el: HTMLElement; latex: string; display: boolean }>(null);

  // Rebuild the box only when the value changed from outside (question loaded,
  // formula inserted) - never while typing, so the cursor stays where it is.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || shown.current === value) return;
    el.innerHTML = toEditorHtml(value);
    shown.current = value;
  }, [value]);

  const emit = () => {
    const el = box.current;
    if (!el) return;
    const next = fromEditor(el);
    shown.current = next;
    if (next !== value) onChange(next);
  };
  const remember = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && box.current?.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange();
  };

  function insertFormula(latex: string, display: boolean) {
    const el = box.current;
    if (!el) return;
    const node = formulaNode(latex, display);
    let range = saved.current && el.contains(saved.current.startContainer) ? saved.current : null;
    if (!range) { range = document.createRange(); range.selectNodeContents(el); range.collapse(false); }
    range.deleteContents();
    // A space either side, so the formula never runs into the words around it.
    range.insertNode(document.createTextNode(" "));
    range.insertNode(node);
    range.insertNode(document.createTextNode(" "));
    const after = document.createRange();
    after.setStartAfter(node.nextSibling ?? node);
    after.collapse(true);
    saved.current = after;
    emit();
    el.focus();
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(after);
  }

  return (
    <div className="space-y-2">
      <div
        ref={box}
        id={id}
        role="textbox"
        aria-multiline="true"
        aria-label="Question text"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-disabled={disabled || undefined}
        data-placeholder={placeholder}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={emit}
        onKeyUp={remember}
        onMouseUp={remember}
        onBlur={remember}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); document.execCommand("insertLineBreak"); }
        }}
        onPaste={(e) => {
          // Plain text only - no styles or pictures pasted in from Word or a web page.
          e.preventDefault();
          document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
        }}
        onClick={(e) => {
          const f = (e.target as HTMLElement).closest<HTMLElement>("[data-latex]");
          if (f && !disabled && box.current?.contains(f)) setPanel({ mode: "edit", el: f, latex: f.dataset.latex ?? "", display: f.dataset.display === "1" });
        }}
        className={`min-h-28 w-full min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      />
      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onMouseDown={(e) => e.preventDefault()} onClick={() => { remember(); setPanel({ mode: "new" }); }}>
            <Sigma className="mr-1.5 h-4 w-4" />Formula
          </Button>
          <span className="text-xs text-muted-foreground">Click a formula in the question to change it.</span>
        </div>
      )}

      {panel && (
        <FormulaPanel
          key={panel.mode === "edit" ? panel.latex : "new"}
          initial={panel.mode === "edit" ? { latex: panel.latex, display: panel.display } : null}
          onClose={() => setPanel(null)}
          onRemove={() => {
            if (panel.mode === "edit") { panel.el.remove(); emit(); }
            setPanel(null);
          }}
          onSubmit={(latex, display) => {
            if (panel.mode === "edit") { panel.el.replaceWith(formulaNode(latex, display)); emit(); }
            else insertFormula(latex, display);
            setPanel(null);
          }}
        />
      )}
    </div>
  );
}

const FORMULA_CLASS = "rounded px-0.5 cursor-pointer hover:bg-primary/10";

/** A typeset formula inside the editor; it can't be typed into, only clicked to edit. */
function formulaNode(latex: string, display: boolean) {
  const el = document.createElement("span");
  el.contentEditable = "false";
  el.dataset.latex = latex;
  el.dataset.display = display ? "1" : "0";
  el.title = "Click to change this formula";
  el.className = `${FORMULA_CLASS} ${display ? "block text-center" : "inline-block"}`;
  el.innerHTML = katexHtml(latex, display);
  return el;
}

/** The stored text (with $...$ formulas) as the editor's HTML. */
function toEditorHtml(value: string) {
  return splitMath(value).map((s) => s.kind === "text"
    ? escapeHtml(s.text).replace(/\n/g, "<br>")
    : `<span contenteditable="false" data-latex="${escapeHtml(s.latex)}" data-display="${s.display ? "1" : "0"}" title="Click to change this formula" class="${FORMULA_CLASS} ${s.display ? "block text-center" : "inline-block"}">${katexHtml(s.latex, s.display)}</span>`,
  ).join("");
}

/** The editor's content back to stored text: line breaks as \n, formulas as $...$. */
function fromEditor(root: HTMLElement): string {
  let out = "";
  const walk = (n: Node) => {
    n.childNodes.forEach((c) => {
      if (c.nodeType === Node.TEXT_NODE) out += (c.nodeValue ?? "").replace(/\u00a0/g, " ");
      else if (c instanceof HTMLElement) {
        if (c.dataset.latex !== undefined) out += formulaToken(c.dataset.latex, c.dataset.display === "1");
        else if (c.tagName === "BR") out += "\n";
        else if (c.tagName === "DIV" || c.tagName === "P") { if (out && !out.endsWith("\n")) out += "\n"; walk(c); }
        else walk(c);
      }
    });
  };
  walk(root);
  // A browser keeps a lone <br> in an emptied box - that is no text.
  return out.trim() ? out : "";
}
