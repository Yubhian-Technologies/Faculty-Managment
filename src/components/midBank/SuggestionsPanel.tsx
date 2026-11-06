"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, MessageSquarePlus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import type { MidBankSuggestion } from "@/types";

// Suggestions on a bank / paper set: colleagues who can view it (teaching a covered section, the HOD, the Exam Cell)
// write one - about the whole thing or a question; the faculty preparing it sees them and marks each done.

export function SuggestionsPanel({ bankId, questions }: { bankId: string; questions?: { id: string; label: string }[] }) {
  const [data, setData] = useState<{ suggestions: MidBankSuggestion[]; canSuggest: boolean; canResolve: boolean } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [text, setText] = useState("");
  const [questionId, setQuestionId] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let off = false;
    fetch(`/api/college/mid-question-banks/${encodeURIComponent(bankId)}/suggestions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { suggestions: MidBankSuggestion[]; canSuggest: boolean; canResolve: boolean } | null) => { if (!off) setData(d); })
      .catch(() => undefined);
    return () => { off = true; };
  }, [bankId, reloadKey]);

  async function add() {
    setBusy("add");
    try {
      const q = questions?.find((x) => x.id === questionId);
      const res = await fetch(`/api/college/mid-question-banks/${encodeURIComponent(bankId)}/suggestions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, ...(q ? { questionId: q.id, questionLabel: q.label } : {}) }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "Could not send");
      setText(""); setQuestionId("");
      toast({ variant: "success", title: "Suggestion sent" });
      setReloadKey((k) => k + 1);
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not send" }); }
    finally { setBusy(""); }
  }

  async function resolve(s: MidBankSuggestion, resolved: boolean) {
    setBusy(s.id);
    try {
      const res = await fetch(`/api/college/mid-question-banks/${encodeURIComponent(bankId)}/suggestions`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ suggestionId: s.id, resolved }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Could not update");
      setReloadKey((k) => k + 1);
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not update" }); }
    finally { setBusy(""); }
  }

  if (!data || (!data.canSuggest && data.suggestions.length === 0)) return null;
  const open = data.suggestions.filter((s) => !s.resolved).length;
  return (
    <Card><CardContent className="space-y-3 p-4">
      <p className="text-sm font-semibold">Suggestions{data.suggestions.length ? ` · ${open} open` : ""}</p>
      {data.canSuggest && (
        <div className="space-y-2">
          {questions && questions.length > 0 && (
            <select aria-label="About" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-64" value={questionId} onChange={(e) => setQuestionId(e.target.value)}>
              <option value="">About the whole paper</option>
              {questions.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
            </select>
          )}
          <Textarea rows={2} placeholder="e.g. Question 4 repeats Mid 1; Part A could use one more unit-3 question" value={text} onChange={(e) => setText(e.target.value)} />
          <Button size="sm" onClick={() => void add()} loading={busy === "add"} disabled={!text.trim()}><MessageSquarePlus className="mr-1.5 h-4 w-4" />Send suggestion</Button>
        </div>
      )}
      {data.suggestions.length > 0 && (
        <ul className="space-y-2">
          {data.suggestions.map((s) => (
            <li key={s.id} className={`rounded-md border px-3 py-2 text-sm ${s.resolved ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{s.byName}{s.questionLabel ? ` · ${s.questionLabel}` : ""} · {new Date(s.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
                {s.resolved && <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Done ({s.resolved.byName})</span>}
              </div>
              <p className="mt-1 whitespace-pre-line">{s.text}</p>
              {data.canResolve && (
                <div className="mt-1.5">
                  {s.resolved
                    ? <Button size="sm" variant="ghost" className="h-7" onClick={() => void resolve(s, false)} loading={busy === s.id}><RotateCcw className="mr-1 h-3.5 w-3.5" />Reopen</Button>
                    : <Button size="sm" variant="outline" className="h-7" onClick={() => void resolve(s, true)} loading={busy === s.id}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Mark done</Button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </CardContent></Card>
  );
}
