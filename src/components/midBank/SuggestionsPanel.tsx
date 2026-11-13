"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, MessageSquarePlus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/useToast";
import type { MidBankSuggestion } from "@/types";

// Suggestions on a bank / paper set: colleagues who can view it (teaching a covered section, the HOD, the Exam Cell)
// write one - about the whole thing or a question; the faculty preparing it sees them and marks each done.
// On an APPROVED one the Exam Cell may tick "Needs changes": it goes back to the faculty (editable past the deadline)
// and must be submitted to and approved by the HOD again.

export function SuggestionsPanel({ bankId, questions }: { bankId: string; questions?: { id: string; label: string }[] }) {
  const [data, setData] = useState<{ suggestions: MidBankSuggestion[]; canSuggest: boolean; canResolve: boolean; canReopen?: boolean } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [text, setText] = useState("");
  const [questionId, setQuestionId] = useState("");
  const [busy, setBusy] = useState("");
  const [reopen, setReopen] = useState(false);

  useEffect(() => {
    let off = false;
    fetch(`/api/college/mid-question-banks/${encodeURIComponent(bankId)}/suggestions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { suggestions: MidBankSuggestion[]; canSuggest: boolean; canResolve: boolean; canReopen?: boolean } | null) => { if (!off) setData(d); })
      .catch(() => undefined);
    return () => { off = true; };
  }, [bankId, reloadKey]);

  async function add() {
    setBusy("add");
    try {
      const q = questions?.find((x) => x.id === questionId);
      const res = await fetch(`/api/college/mid-question-banks/${encodeURIComponent(bankId)}/suggestions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, ...(q ? { questionId: q.id, questionLabel: q.label } : {}), ...(reopen ? { reopen: true } : {}) }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "Unable to send");
      setText(""); setQuestionId("");
      if (reopen) {
        toast({ variant: "success", title: "Sent back to the faculty for changes - the HOD approves it again after they resubmit" });
        window.location.reload();
        return;
      }
      toast({ variant: "success", title: "Suggestion sent" });
      setReloadKey((k) => k + 1);
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to send" }); }
    finally { setBusy(""); }
  }

  async function resolve(s: MidBankSuggestion, resolved: boolean) {
    setBusy(s.id);
    try {
      const res = await fetch(`/api/college/mid-question-banks/${encodeURIComponent(bankId)}/suggestions`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ suggestionId: s.id, resolved }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Unable to update");
      setReloadKey((k) => k + 1);
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to update" }); }
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
          <Textarea rows={2} placeholder="Question 4 repeats Mid 1; Part A could use one more unit-3 question" value={text} onChange={(e) => setText(e.target.value)} />
          {data.canReopen && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox className="mt-0.5" checked={reopen} onCheckedChange={(c) => setReopen(c === true)} />
              <span><span className="font-medium">Needs changes - reopen for the faculty</span>
                <span className="block text-xs text-muted-foreground">The approval is removed: the faculty can edit it (even after the deadline), then submit it to the HOD to approve again. Leave unticked for a comment only.</span></span>
            </label>
          )}
          <Button size="sm" onClick={() => void add()} loading={busy === "add"} disabled={!text.trim()}><MessageSquarePlus className="mr-1.5 h-4 w-4" />{reopen ? "Send back for changes" : "Send suggestion"}</Button>
        </div>
      )}
      {data.suggestions.length > 0 && (
        <ul className="space-y-2">
          {data.suggestions.map((s) => (
            <li key={s.id} className={`rounded-md border px-3 py-2 text-sm ${s.resolved ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{s.reopen && <span className="mr-1.5 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">Needs changes</span>}{s.byName}{s.questionLabel ? ` · ${s.questionLabel}` : ""} · {new Date(s.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
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
