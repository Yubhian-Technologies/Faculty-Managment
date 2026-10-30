"use client";

import { useMemo, useState } from "react";
import { CheckCheck, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { dayLabel, timeLabel } from "@/lib/midTimetable/rules";
import { DUTY_CATEGORY_LABELS, type InvigilationDuty } from "@/types/invigilation";
import { STATUS_TONE, type Overview } from "./model";

// Exam Cell > Invigilation > Duties: every duty by exam session, published
// exam-wise - faculty hear of a duty only when its session is published.
// Each duty's history (who did what) is one click away.

const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const sessionLabel = (s: string) => { const [d, t] = s.split("|"); const [f, to] = (t ?? "").split("-"); return `${dayLabel(d)} · ${timeLabel(f)} - ${timeLabel(to)}`; };

export function DutiesPanel({ overview, onChanged, onOpenSlot }: { overview: Overview; onChanged: () => void; onOpenSlot: (slotKey: string) => void }) {
  const { schedule, duties, slots, sessions } = overview;
  const [status, setStatus] = useState("ACTIVE");
  const [confirm, setConfirm] = useState<{ action: "publish" | "complete"; session: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const bySession = useMemo(() => sessions.map((s) => {
    const list = duties.filter((d) => d.session === s && (status === "ALL" || (status === "ACTIVE" ? !["CANCELLED", "REASSIGNED"].includes(d.status) : d.status === status)))
      .sort((a, b) => a.category.localeCompare(b.category) || (a.room ?? "").localeCompare(b.room ?? "", undefined, { numeric: true }) || a.facultyName.localeCompare(b.facultyName));
    const need = slots.filter((x) => x.session === s).reduce((n, x) => n + x.required, 0);
    const have = slots.filter((x) => x.session === s).reduce((n, x) => n + Math.min(x.filled, x.required), 0);
    return { s, list, need, have, drafts: duties.filter((d) => d.session === s && d.status === "DRAFT").length };
  }), [sessions, duties, slots, status]);

  async function run() {
    if (!confirm) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/college/invigilation/schedules/${schedule.id}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: confirm.action, sessions: [confirm.session] }) });
      const data = (await res.json()) as { published?: number; completed?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      toast({ variant: "success", title: confirm.action === "publish" ? `${data.published} duties published - faculty notified` : `${data.completed} duties marked done` });
      setConfirm(null);
      onChanged();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  const row = (d: InvigilationDuty) => (
    <tr key={d.id} className="border-t align-top">
      <td className="p-2">{DUTY_CATEGORY_LABELS[d.category]}</td>
      <td className="p-2"><button type="button" className="text-left hover:underline" onClick={() => onOpenSlot(d.slotKey)}>{d.room ?? "Session"}</button></td>
      <td className="p-2"><span className="font-medium">{d.facultyName}</span><span className="block text-xs text-muted-foreground">{d.employeeId} · {d.department}</span></td>
      <td className="p-2">
        <Badge variant={STATUS_TONE[d.status]}>{d.status.toLowerCase()}</Badge>
        {d.overrides?.length ? <Badge variant="modified" className="ml-1" title={d.overrides.map((o) => `${o.message} - ${o.reason} (${o.byName})`).join("\n")}>override</Badge> : null}
      </td>
      <td className="p-2 text-xs">
        <button type="button" className="text-muted-foreground hover:underline" onClick={() => setOpen(open === d.id ? null : d.id)}>History ({d.history?.length ?? 0})</button>
        {open === d.id && (
          <ul className="mt-1 space-y-0.5">
            {(d.history ?? []).map((h, i) => <li key={i}>{new Date(h.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} · {h.action.toLowerCase().replace(/_/g, " ")} · {h.byName}{h.note ? ` - ${h.note}` : ""}</li>)}
            {(d.overrides ?? []).map((o, i) => <li key={`o${i}`} className="text-amber-700 dark:text-amber-400">Override: {o.message} - &ldquo;{o.reason}&rdquo; ({o.byName})</li>)}
          </ul>
        )}
      </td>
    </tr>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="du-status" className="text-muted-foreground">Show</label>
        <select id="du-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="ACTIVE">Current duties</option><option value="DRAFT">Drafts</option><option value="PUBLISHED">Published</option><option value="ACKNOWLEDGED">Acknowledged</option>
          <option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option><option value="REASSIGNED">Reassigned</option><option value="ALL">Everything</option>
        </select>
      </div>
      {bySession.map(({ s, list, need, have, drafts }) => {
        const published = schedule.publishedSessions.includes(s);
        return (
          <Card key={s}>
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                <div>
                  <p className="font-medium">{sessionLabel(s)}</p>
                  <p className="text-xs text-muted-foreground">{have}/{need} places filled{published ? " · published to faculty" : " · not published - faculty can't see these yet"}</p>
                </div>
                {schedule.status === "ACTIVE" && (
                  <div className="flex gap-2">
                    <Button size="sm" variant={published ? "outline" : "default"} disabled={!drafts} onClick={() => setConfirm({ action: "publish", session: s })}><Send className="mr-1 h-4 w-4" />{published ? `Publish ${drafts} new` : "Publish this exam"}</Button>
                    {published && <Button size="sm" variant="outline" onClick={() => setConfirm({ action: "complete", session: s })}><CheckCheck className="mr-1 h-4 w-4" />Mark done</Button>}
                  </div>
                )}
              </div>
              {list.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">No duties here.</p> : (
                <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="p-2">Duty</th><th className="p-2">Room</th><th className="p-2">Faculty</th><th className="p-2">Status</th><th className="p-2">History</th></tr></thead><tbody>{list.map(row)}</tbody></table></div>
              )}
            </CardContent>
          </Card>
        );
      })}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.action === "publish" ? "Publish this exam's duties?" : "Mark this exam's duties done?"}
        description={confirm?.action === "publish" ? `The draft duties of ${confirm ? sessionLabel(confirm.session) : ""} go to the faculty (each is notified and sees it under My Invigilation Duties). Changes after this notify them too.` : "Every published / acknowledged duty of this session becomes completed."}
        confirmLabel={confirm?.action === "publish" ? "Publish" : "Mark done"}
        loading={busy}
        onConfirm={run}
      />
    </div>
  );
}
