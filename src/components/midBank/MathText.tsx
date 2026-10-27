"use client";

import { useMemo, useRef } from "react";
import "katex/dist/katex.min.css";
import { FORMULA_SNIPPETS, renderMathHtml } from "@/lib/midBank/renderMath";
import { Textarea } from "@/components/ui/textarea";

/** Question text with its $...$ formulas rendered (text is escaped - see renderMathHtml). */
export function MathText({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => renderMathHtml(text), [text]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** A textarea with a formula toolbar: a button inserts its LaTeX at the cursor (inside $...$ when needed). */
export function FormulaTextarea({ id, value, onChange, placeholder, invalid, describedBy }: {
  id: string; value: string; onChange: (v: string) => void; placeholder?: string; invalid?: boolean; describedBy?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function insert(snippet: (typeof FORMULA_SNIPPETS)[number]) {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    // Outside a formula, wrap the snippet in $...$ so it renders.
    const before = value.slice(0, start);
    const inside = (before.match(/\$/g)?.length ?? 0) % 2 === 1;
    const wrap = !inside && snippet.insert !== "$ $";
    const text = wrap ? `$${snippet.insert}$` : snippet.insert;
    const cursor = start + snippet.cursor + (wrap ? 1 : 0);
    onChange(value.slice(0, start) + text + value.slice(end));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(cursor, cursor); });
  }

  return (
    <div className="rounded-md border focus-within:ring-2 focus-within:ring-ring">
      <div className="flex flex-wrap gap-1 border-b bg-muted/40 p-1" role="toolbar" aria-label="Insert formula">
        {FORMULA_SNIPPETS.map((s) => (
          <button
            key={s.title}
            type="button"
            title={s.title}
            aria-label={`Insert ${s.title.toLowerCase()}`}
            onClick={() => insert(s)}
            className="min-w-8 rounded px-2 py-1 text-sm hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {s.label}
          </button>
        ))}
      </div>
      <Textarea
        ref={ref}
        id={id}
        value={value}
        rows={4}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-28 resize-y rounded-none border-0 focus-visible:ring-0"
      />
    </div>
  );
}
