"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileDown, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { QUESTIONS_PER_UNIT } from "@/lib/midBank/constants";
import { findDuplicates } from "@/lib/midBank/duplicates";
import { derivePoPso } from "@/lib/midBank/outcomes";
import { bloomNeeds } from "@/lib/midBank/rules";
import { questionErrors } from "@/lib/midBank/validateQuestion";
import { downloadMidQuestionBankPdf } from "@/lib/pdf/downloadMidQuestionBank";
import type { MidBankDetail } from "@/lib/midBank/clientTypes";
import { MathText } from "./MathText";

// Stage 5: the whole bank at a glance - what is done, what is still missing
// (each issue links to its question), a full preview, and the PDF once every
// unit is complete. Opening it reads only; nothing is written.

interface Issue { level: "error" | "warn"; text: string; qid?: string }

export function BankReview({ id, editHref, autoDownload }: { id: string; editHref?: (qid: string) => string; autoDownload?: boolean }) {
  const [detail, setDetail] = useState<MidBankDetail | null>(null);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const autoDone = useRef(false);

  useEffect(() => {
    fetch(`/api/college/mid-question-banks/${encodeURIComponent(id)}`)
      .then(async (r) => {
        const d = (await r.json()) as MidBankDetail & { error?: string };
        if (!r.ok) throw new Error(d.error ?? "Failed to load the question bank");
        setDetail(d);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load the question bank"));
  }, [id]);

  const bank = detail?.bank ?? null;
  const ready = bank?.status === "COMPLETE";

  const issues = useMemo<Issue[]>(() => {
    if (!detail?.bank) return [];
    const b = detail.bank;
    const out: Issue[] = [];
    const qs = detail.questions;
    for (const u of b.units) {
      const st = b.unitStatus[String(u)];
      const empty = QUESTIONS_PER_UNIT - qs.filter((q) => q.unit === u).length;
      if (empty > 0) out.push({ level: "error", text: `Unit ${u}: ${empty} question slot${empty > 1 ? "s" : ""} still empty` });
      for (const n of bloomNeeds(st?.bloom ?? { L2: 0, L3: 0, L4: 0 })) if (n.need) out.push({ level: "error", text: `Unit ${u}: ${n.level} used ${n.count} time${n.count === 1 ? "" : "s"} - needs ${n.need} more` });
    }
    for (const q of [...qs].sort((a, b2) => a.unit - b2.unit || a.slot - b2.slot)) {
      if (q.state === "DRAFT") {
        const errs = Object.values(questionErrors(q.parts, b.format));
        out.push({ level: "error", qid: q.id, text: `Unit ${q.unit} Q${q.slot} is a draft${errs.length ? ` - ${errs[0]}` : ""}` });
      }
      const others = qs.filter((o) => o.id > q.id);
      const dup = findDuplicates(q.textKeys ?? [], others);
      for (const h of dup.exact) if (h.id) out.push({ level: "error", qid: q.id, text: `Unit ${q.unit} Q${q.slot} is the same as Unit ${h.unit} Q${h.slot}` });
      for (const h of dup.similar) out.push({ level: "warn", qid: q.id, text: `Unit ${q.unit} Q${q.slot} looks similar to Unit ${h.unit} Q${h.slot}` });
    }
    return out;
  }, [detail]);

  const download = useCallback(async () => {
    if (!detail?.bank || !detail.outcomes) return;
    setDownloading(true);
    try {
      await downloadMidQuestionBankPdf({
        subject: detail.subject, facultyName: detail.assignment.facultyName,
        bank: detail.bank, outcomes: detail.outcomes, questions: detail.questions,
      });
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not make the PDF" });
    } finally {
      setDownloading(false);
    }
  }, [detail]);

  useEffect(() => {
    if (autoDownload && ready && !autoDone.current) { autoDone.current = true; void download(); }
  }, [autoDownload, ready, download]);

  if (error) return <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</p>;
  if (!detail) return <div className="h-96 animate-pulse rounded-lg bg-muted" />;
  if (!bank || !detail.outcomes) {
    return <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">This question bank hasn&rsquo;t been started yet.</p>;
  }

  const drafts = detail.questions.filter((q) => q.state === "DRAFT").length;
  const unitsDone = bank.units.filter((u) => bank.unitStatus[String(u)]?.complete).length;
  const marksEach = bank.format === "PARTS_AB" ? bank.marks / 2 : bank.marks;
  const byId = new Map(detail.questions.map((q) => [q.id, q]));
  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Questions required", bank.totalCount],
          ["Complete", bank.completeCount],
          ["Drafts", drafts],
          ["Units complete", `${unitsDone} of ${bank.units.length}`],
        ].map(([label, value]) => (
          <Card key={label as string}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{value}</p></CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">{ready ? "Ready for the PDF" : "Still to do"}</CardTitle>
          <Button onClick={() => void download()} disabled={!ready} loading={downloading}><FileDown className="mr-1.5 h-4 w-4" />Download PDF</Button>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {ready && errors.length === 0 && <p className="flex items-center gap-2 text-green-700 dark:text-green-400"><CheckCircle2 className="h-4 w-4" />Every unit is complete.</p>}
          {!ready && <p className="flex items-center gap-2 text-muted-foreground"><Info className="h-4 w-4" />The PDF is available once every unit has 10 complete questions and L2, L3 and L4 at least 3 times each.</p>}
          {bank.units.map((u) => {
            const st = bank.unitStatus[String(u)];
            return (
              <div key={u} className="flex flex-wrap items-center gap-2">
                <span className="w-16 font-medium">Unit {u}</span>
                <Badge variant={st?.complete ? "default" : "outline"}>{st?.complete ? "Complete" : `${st?.completeCount ?? 0}/${QUESTIONS_PER_UNIT}`}</Badge>
                {bloomNeeds(st?.bloom ?? { L2: 0, L3: 0, L4: 0 }).map((b) => (
                  <Badge key={b.level} variant="outline" className={b.need ? "border-amber-500/60 text-amber-800 dark:text-amber-300" : "border-green-600/50 text-green-800 dark:text-green-300"}>{b.level}: {b.count}</Badge>
                ))}
              </div>
            );
          })}
          {issues.length > 0 && (
            <ul className="space-y-1.5 border-t pt-3">
              {[...errors, ...warns].map((i, n) => (
                <li key={n} className="flex items-start gap-2">
                  <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${i.level === "error" ? "text-destructive" : "text-amber-600"}`} />
                  <span className="flex-1">{i.text}</span>
                  {i.qid && editHref && <Link className="shrink-0 text-xs text-primary underline" href={editHref(i.qid)}>Open</Link>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Preview</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          {bank.units.map((u) => (
            <section key={u}>
              <h3 className="mb-2 font-semibold">Unit {u} - {detail.outcomes!.units.find((x) => x.no === u)?.title}</h3>
              <ol className="space-y-3">
                {Array.from({ length: QUESTIONS_PER_UNIT }, (_, i) => i + 1).map((s) => {
                  const q = byId.get(`${u}_${s}`);
                  return (
                    <li key={s} className="flex gap-3 border-b pb-3 last:border-0">
                      <span className="w-6 shrink-0 font-medium">{s}.</span>
                      <div className="min-w-0 flex-1 space-y-2">
                        {!q ? <span className="text-sm text-muted-foreground">Empty</span> : q.parts.map((p, i) => (
                          <div key={i} className="text-sm">
                            {bank.format === "PARTS_AB" && <span className="mr-1 font-medium">({i === 0 ? "a" : "b"})</span>}
                            <MathText text={p.text || "-"} className="inline" />
                            {/* eslint-disable-next-line @next/next/no-img-element -- Storage URL with a token */}
                            {p.imageUrl && <figure className="mt-2"><img src={p.imageUrl} alt={p.imageCaption || ""} className="max-h-40 rounded border" />{p.imageCaption && <figcaption className="text-xs text-muted-foreground">{p.imageCaption}</figcaption>}</figure>}
                            <p className="mt-1 text-xs text-muted-foreground">
                              [{marksEach} M] · {p.cos.join(", ") || "No CO"} · {derivePoPso(p.cos, detail.outcomes!.mapping).map((x) => x.id).join(", ") || "-"} · {p.bloom || "No level"}
                            </p>
                          </div>
                        ))}
                        {q?.state === "DRAFT" && <Badge variant="secondary">Draft</Badge>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
