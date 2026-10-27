"use client";

import { useState } from "react";
import { BookOpen, Briefcase, Check, FileCheck2, HeartHandshake, Home, Pencil, Plus, Target, Trash2, Users, X, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { formatEntryDate, formatEntryMonth, type EntryColumn, type EntrySection as Section } from "@/lib/mentoring/recordSections";
import type { MentoringEntry } from "@/types/mentoring";
import { sendJson } from "./recordApi";

// One table or list of the Student Mentoring Record (scholarships, internships, meetings, ...),
// drawn from its definition in lib/mentoring/recordSections.ts: rows are added, corrected and
// removed in place, and saved one at a time.

type Value = string | boolean | string[];
type Values = Record<string, Value>;

export interface EntryEditor {
  add: (entry: MentoringEntry) => void;
  replace: (entry: MentoringEntry) => void;
  remove: (id: string) => void;
}

// An icon per meeting discussion category (by its stored value) for the choice cards.
const CHOICE_ICONS: Record<string, LucideIcon> = {
  ACADEMIC: BookOpen,
  WELLBEING: HeartHandshake,
  CAREER: Briefcase,
  ENGAGEMENT: Users,
  CAMPUS_FAMILY: Home,
  GOALS: Target,
};

// The meeting form is lettered like the booklet; other sections show their columns in one block.
const MEETING_GROUPS: { title: string; keys: string[] }[] = [
  { title: "A. Meeting details", keys: ["date"] },
  { title: "B. Discussion categories", keys: ["categories"] },
  { title: "C. Action and follow-up", keys: ["purpose", "outcome", "studentSigned"] },
];

function cellText(col: EntryColumn, v: Value | undefined): string {
  if (Array.isArray(v)) return v.map((x) => col.choices?.find((c) => c.value === x)?.label ?? x).join(", ");
  if (typeof v !== "string" || !v) return "";
  if (col.kind === "date") return formatEntryDate(v);
  if (col.kind === "month") return formatEntryMonth(v);
  return v;
}

function ColumnInput({ col, value, onChange, autoFocus }: { col: EntryColumn; value: Value | undefined; onChange: (v: Value) => void; autoFocus?: boolean }) {
  const text = typeof value === "string" ? value : "";
  switch (col.kind) {
    case "textarea":
      return <Textarea value={text} rows={3} autoFocus={autoFocus} placeholder={col.placeholder} maxLength={col.max ?? 1000} onChange={(e) => onChange(e.target.value)} />;
    case "date":
      return <Input type="date" value={text} onChange={(e) => onChange(e.target.value)} />;
    case "month":
      return <Input type="month" value={text} onChange={(e) => onChange(e.target.value)} />;
    case "select":
      return (
        <Select value={text} onValueChange={onChange}>
          <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
          <SelectContent>{(col.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
      );
    case "multiselect": {
      const chosen = Array.isArray(value) ? value : [];
      return (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {(col.choices ?? []).map((c) => {
            const on = chosen.includes(c.value);
            const Icon = CHOICE_ICONS[c.value];
            return (
              <label
                key={c.value}
                className={`relative flex flex-col gap-1.5 rounded-lg border p-3 text-sm cursor-pointer transition-colors hover:bg-muted/50 ${on ? "border-primary bg-primary/5 ring-1 ring-primary" : "bg-background"}`}
              >
                <span className="flex items-center justify-between">
                  {Icon ? <Icon className={`h-5 w-5 ${on ? "text-primary" : "text-muted-foreground"}`} /> : <span />}
                  <Checkbox checked={on} onCheckedChange={(v) => onChange(v === true ? [...chosen, c.value] : chosen.filter((x) => x !== c.value))} />
                </span>
                <span className="font-medium">{c.label}</span>
                {c.hint && <span className="text-xs text-muted-foreground">{c.hint}</span>}
              </label>
            );
          })}
        </div>
      );
    }
    case "check":
      return (
        <label className="flex items-center gap-2 text-sm h-9">
          <Checkbox checked={value === true} onCheckedChange={(v) => onChange(v === true)} />
          <span>Yes</span>
        </label>
      );
    default:
      return <Input value={text} autoFocus={autoFocus} placeholder={col.placeholder} maxLength={col.max ?? 200} onChange={(e) => onChange(e.target.value)} />;
  }
}

function EntryForm({
  section, initial, saving, onSave, onCancel,
}: { section: Section; initial: Values; saving: boolean; onSave: (v: Values) => void; onCancel: () => void }) {
  const [values, setValues] = useState<Values>(initial);
  const missingRequired = section.columns.some((c) => {
    if (!c.required) return false;
    const v = values[c.key];
    return Array.isArray(v) ? v.length === 0 : !(typeof v === "string" && v.trim());
  });
  return (
    <form
      className="rounded-lg border bg-muted/30 p-3 space-y-3 print:hidden"
      onSubmit={(e) => { e.preventDefault(); if (!missingRequired) onSave(values); }}
    >
      {(section.key === "meetings"
        ? MEETING_GROUPS.map((g) => ({ title: g.title, columns: g.keys.map((k) => section.columns.find((c) => c.key === k)).filter((c): c is EntryColumn => !!c) }))
        : [{ title: "", columns: section.columns }]
      ).map((group) => (
        <div key={group.title} className="space-y-2">
          {group.title && (
            <div>
              <h4 className="text-sm font-semibold">{group.title}</h4>
              {group.columns.some((c) => c.kind === "multiselect") && <p className="text-xs text-muted-foreground">Select all categories discussed during the meeting.</p>}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {group.columns.map((c) => (
              <div key={c.key} className={c.kind === "textarea" || c.kind === "multiselect" ? "sm:col-span-2" : ""}>
                {c.kind !== "multiselect" && <label className="text-xs text-muted-foreground mb-1 block">{c.label}{c.required ? " *" : ""}</label>}
                <ColumnInput col={c} value={values[c.key]} autoFocus={c === section.columns[0]} onChange={(v) => setValues((prev) => ({ ...prev, [c.key]: v }))} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}><X className="h-4 w-4 mr-1" /> Cancel</Button>
        <Button type="submit" size="sm" disabled={saving || missingRequired}><Check className="h-4 w-4 mr-1" /> {saving ? "Saving…" : "Save"}</Button>
      </div>
    </form>
  );
}

export function EntrySectionView({
  section, entries, api, editor, semester, heading = "h3", hideTitle, readOnly,
}: {
  /** The student's own view: rows are shown, never added, edited or removed. */
  readOnly?: boolean;
  section: Section;
  entries: MentoringEntry[];
  /** /api/college/mentoring/students/{id} */
  api: string;
  editor: EntryEditor;
  /** For per-semester sections: the semester new rows are filed under. */
  semester?: number;
  heading?: "h2" | "h3";
  hideTitle?: boolean;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [saving, setSaving] = useState(false);

  const rows = entries
    .filter((e) => e.section === section.key && (!section.perSemester || e.semester === (semester ?? null)))
    .sort((a, b) => {
      const da = typeof a.values.date === "string" ? a.values.date : "";
      const db = typeof b.values.date === "string" ? b.values.date : "";
      return da && db ? da.localeCompare(db) : (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
    });
  const full = rows.length >= section.maxEntries;
  const Title = heading;

  async function save(values: Values) {
    setSaving(true);
    try {
      if (editing === "new") {
        const d = await sendJson<{ entry: MentoringEntry }>(`${api}/record/entries`, "POST", { section: section.key, semester: section.perSemester ? semester : undefined, values });
        editor.add(d.entry);
      } else if (editing) {
        const d = await sendJson<{ entry: MentoringEntry }>(`${api}/record/entries/${editing}`, "PATCH", { values });
        editor.replace(d.entry);
      }
      setEditing(null);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this row from the record?")) return;
    try {
      await sendJson(`${api}/record/entries/${id}`, "DELETE");
      editor.remove(id);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not remove" });
    }
  }

  const rowActions = (id: string) => readOnly ? null : (
    <div className="flex gap-1 justify-end print:hidden">
      <button type="button" className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground" aria-label="Edit" onClick={() => setEditing(id)}><Pencil className="h-3.5 w-3.5" /></button>
      <button type="button" className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-red-600" aria-label="Remove" onClick={() => remove(id)}><Trash2 className="h-3.5 w-3.5" /></button>
    </div>
  );

  const formFor = (id: string | "new") => (
    <EntryForm
      key={id}
      section={section}
      initial={id === "new" ? {} : (entries.find((e) => e.id === id)?.values ?? {})}
      saving={saving}
      onSave={save}
      onCancel={() => setEditing(null)}
    />
  );

  return (
    <Card className="break-inside-avoid">
      <CardContent className="pt-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          {!hideTitle && (
            <div className="min-w-0">
              <Title className="text-base font-semibold leading-tight">{section.title}</Title>
              {section.hint && <p className="text-xs text-muted-foreground mt-0.5">{section.hint}</p>}
            </div>
          )}
          {!readOnly && editing !== "new" && (
            <Button size="sm" variant="outline" className="print:hidden ml-auto" disabled={full} onClick={() => setEditing("new")} title={full ? "This table is full" : undefined}>
              <Plus className="h-4 w-4 mr-1" /> {section.addLabel}
            </Button>
          )}
        </div>

        {editing === "new" && formFor("new")}

        {rows.length === 0 && editing !== "new" && <p className="text-sm text-muted-foreground py-1">{section.emptyText}</p>}

        {rows.length > 0 && section.layout === "list" && (
          <ul className="divide-y">
            {rows.map((r) => editing === r.id ? <li key={r.id} className="py-2">{formFor(r.id)}</li> : (
              <li key={r.id} className="py-2.5 flex items-start gap-3">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm whitespace-pre-wrap break-words">{cellText(section.columns[0], r.values[section.columns[0].key])}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {typeof r.values.date === "string" && <span>{formatEntryDate(r.values.date)}</span>}
                    {r.values.docReceived === true && <Badge variant="secondary" className="gap-1"><FileCheck2 className="h-3 w-3" /> Document received</Badge>}
                  </div>
                </div>
                {rowActions(r.id)}
              </li>
            ))}
          </ul>
        )}

        {rows.length > 0 && section.layout === "table" && (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 pr-3 font-medium w-8">#</th>
                  {section.columns.map((c) => <th key={c.key} className="py-2 pr-3 font-medium">{c.label}</th>)}
                  <th className="print:hidden w-16" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => editing === r.id ? (
                  <tr key={r.id}><td colSpan={section.columns.length + 2} className="py-2">{formFor(r.id)}</td></tr>
                ) : (
                  <tr key={r.id} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-3 text-muted-foreground tabular-nums">{i + 1}</td>
                    {section.columns.map((c) => (
                      <td key={c.key} className="py-2 pr-3 whitespace-pre-wrap break-words">
                        {c.kind === "check"
                          ? (r.values[c.key] === true ? <Check className="h-4 w-4 text-emerald-600" aria-label="Yes" /> : <span className="text-muted-foreground">—</span>)
                          : c.kind === "multiselect" && Array.isArray(r.values[c.key])
                          ? <div className="flex flex-wrap gap-1">{(r.values[c.key] as string[]).map((x) => <Badge key={x} variant="secondary" className="font-normal">{cellText(c, [x])}</Badge>)}</div>
                          : (cellText(c, r.values[c.key]) || <span className="text-muted-foreground">—</span>)}
                      </td>
                    ))}
                    <td className="py-1.5">{rowActions(r.id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
