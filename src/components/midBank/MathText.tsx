"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import "katex/dist/katex.min.css";
import { Sigma } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formulaToken, katexHtml, renderMathHtml, splitMath } from "@/lib/midBank/renderMath";
import { FormulaPanel } from "./FormulaPanel";

/** Question text with its $...$ formulas rendered (text is escaped - see renderMathHtml). */
export function MathText({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => renderMathHtml(text), [text]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * The question box: plain text, plus a "Formula" button that opens the visual
 * formula pop-up and inserts the formula where the cursor was. Right under the
 * box, a live preview shows the text with its formulas typeset; clicking a
 * formula there opens it for editing (Update / Remove). Faculty never type LaTeX.
 */
export function QuestionTextField({ id, value, onChange, placeholder, invalid, describedBy, disabled }: {
  id: string; value: string; onChange: (v: string) => void; placeholder?: string; invalid?: boolean; describedBy?: string; disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null); // where a new formula goes
  // null = closed; { at } = new formula at a position; { start, end, ... } = editing one.
  const [panel, setPanel] = useState<null | { mode: "new"; at: number } | { mode: "edit"; start: number; end: number; latex: string; display: boolean }>(null);
  const segments = useMemo(() => splitMath(value), [value]);
  const hasMath = segments.some((s) => s.kind === "math");
  const remember = () => { caret.current = ref.current?.selectionStart ?? null; };

  function place(token: string, start: number, end: number) {
    const before = value.slice(0, start);
    const after = value.slice(end);
    // A space between the formula and the words around it, where there isn't one.
    const lead = before && !/\s$/.test(before) ? " " : "";
    const trail = after && !/^\s/.test(after) ? " " : "";
    const next = before + lead + token + trail + after;
    onChange(next);
    const pos = (before + lead + token + trail).length;
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(pos, pos); });
  }

  return (
    <div className="space-y-2">
      <Textarea
        ref={ref}
        id={id}
        value={value}
        rows={4}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        onSelect={remember}
        onKeyUp={remember}
        onClick={remember}
        className="min-h-28 resize-y"
      />
      {!disabled && (
        <Button type="button" size="sm" variant="outline" onClick={() => setPanel({ mode: "new", at: caret.current ?? value.length })}>
          <Sigma className="mr-1.5 h-4 w-4" />Formula
        </Button>
      )}

      {panel && (
        <FormulaPanel
          key={panel.mode === "edit" ? `e${panel.start}` : `n${panel.at}`}
          initial={panel.mode === "edit" ? { latex: panel.latex, display: panel.display } : null}
          onClose={() => setPanel(null)}
          onRemove={() => {
            if (panel.mode === "edit") onChange((value.slice(0, panel.start) + value.slice(panel.end)).replace(/ {2,}/g, " "));
            setPanel(null);
          }}
          onSubmit={(latex, display) => {
            const token = formulaToken(latex, display);
            if (panel.mode === "edit") onChange(value.slice(0, panel.start) + token + value.slice(panel.end));
            else place(token, panel.at, panel.at);
            setPanel(null);
          }}
        />
      )}

      {hasMath && (
        <div className="rounded-md border bg-muted/30 p-2 text-sm">
          <p className="mb-1 text-xs text-muted-foreground">As it will print - click a formula to change it</p>
          <div>
            {segments.map((s, i) => s.kind === "text" ? (
              <Fragment key={i}>{s.text.split("\n").map((line, j) => <Fragment key={j}>{j > 0 && <br />}{line}</Fragment>)}</Fragment>
            ) : (
              <button key={i} type="button" disabled={disabled} title="Edit this formula"
                onClick={() => setPanel({ mode: "edit", start: s.start, end: s.end, latex: s.latex, display: s.display })}
                className={`${s.display ? "block w-full" : "inline"} rounded px-0.5 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default`}
                dangerouslySetInnerHTML={{ __html: katexHtml(s.latex, s.display) }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
