"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { MathfieldElement } from "mathlive";

// The formula pop-up: a visual maths box (MathLive) - type with the keyboard
// (^ power, _ subscript, / fraction, sqrt, sum, int, lim, pi, alpha, <=, != ...)
// or the on-screen keypad (tabs 123, symbols, abc, Greek; Shift for the second
// functions) - and insert it into the question. The formula is stored as plain
// LaTeX between $...$, so the preview, review and PDF typeset it with KaTeX.
// MathLive is loaded only when this panel opens.

let mathliveReady: Promise<typeof import("mathlive")> | null = null;
function loadMathlive() {
  mathliveReady ??= import("mathlive").then((m) => {
    m.MathfieldElement.fontsDirectory = "/mathlive/fonts"; // served from public/, no outside CDN
    m.MathfieldElement.soundsDirectory = null;
    return m;
  });
  return mathliveReady;
}

export function FormulaPanel({ initial, onSubmit, onRemove, onClose }: {
  /** The formula being edited, or null to write a new one. */
  initial: { latex: string; display: boolean } | null;
  onSubmit: (latex: string, display: boolean) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const field = useRef<MathfieldElement | null>(null);
  const [ready, setReady] = useState(false);
  const [empty, setEmpty] = useState(!initial?.latex);
  const [display, setDisplay] = useState(initial?.display ?? false);
  const editing = Boolean(initial);

  useEffect(() => {
    let cancelled = false;
    void loadMathlive().then(({ MathfieldElement }) => {
      if (cancelled || !host.current) return;
      const mf = new MathfieldElement();
      mf.mathVirtualKeyboardPolicy = "auto"; // keyboard icon in the box; opens on touch screens by itself
      mf.smartFence = true;
      mf.setAttribute("aria-label", "Formula");
      mf.style.width = "100%";
      mf.style.fontSize = "1.25rem";
      mf.style.padding = "0.25rem 0.5rem";
      mf.style.border = "1px solid hsl(var(--input))";
      mf.style.borderRadius = "0.375rem";
      if (initial?.latex) mf.value = initial.latex;
      mf.addEventListener("input", () => setEmpty(!mf.value.trim()));
      host.current.appendChild(mf);
      field.current = mf;
      if (typeof window !== "undefined" && window.mathVirtualKeyboard) {
        window.mathVirtualKeyboard.layouts = ["numeric", "symbols", "alphabetic", "greek"];
      }
      setReady(true);
      requestAnimationFrame(() => mf.focus());
    });
    return () => {
      cancelled = true;
      window.mathVirtualKeyboard?.hide();
      field.current?.remove();
      field.current = null;
    };
    // The panel is remounted for each formula; `initial` is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit() {
    // "latex-expanded" turns MathLive's own shorthands into standard LaTeX that KaTeX prints.
    const latex = field.current?.getValue("latex-expanded").trim() ?? "";
    if (!latex) return;
    window.mathVirtualKeyboard?.hide();
    onSubmit(latex, display);
  }

  return (
    <div className="space-y-3 rounded-md border border-primary/40 bg-background p-3" role="group" aria-label={editing ? "Edit formula" : "Formula"}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{editing ? "Edit formula" : "Formula"}</span>
        <button type="button" onClick={() => { window.mathVirtualKeyboard?.hide(); onClose(); }} aria-label="Close the formula panel"
          className="rounded p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div ref={host} className="min-h-11">
        {!ready && <span className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading the formula editor…</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        Type: <code>^</code> power, <code>_</code> subscript, <code>/</code> fraction, <code>sqrt</code>, <code>sum</code>, <code>int</code>, <code>lim</code>, <code>pi</code>, <code>alpha</code>, <code>&lt;=</code>. Use the → arrow to leave a power or fraction. The keyboard icon in the box opens the keypad.
      </p>
      <div className="flex items-center gap-2">
        <Checkbox id="formula-display" checked={display} onCheckedChange={(v) => setDisplay(v === true)} />
        <Label htmlFor="formula-display" className="text-sm font-normal">Show on its own line (centred)</Label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={submit} disabled={!ready || empty}>{editing ? "Update formula" : "Insert into question"}</Button>
        {editing && <Button size="sm" variant="outline" onClick={() => { window.mathVirtualKeyboard?.hide(); onRemove(); }}>Remove formula</Button>}
      </div>
    </div>
  );
}
