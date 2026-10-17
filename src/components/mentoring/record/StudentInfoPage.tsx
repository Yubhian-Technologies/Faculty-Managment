"use client";

import { useMemo, useState } from "react";
import { Info, Lock, Pencil, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { CATEGORY_OPTIONS, QUALIFICATION_OPTIONS, entrySection } from "@/lib/mentoring/recordSections";
import type { MentoringEntry, MentoringRecordProfile, RecordFieldView } from "@/types/mentoring";
import { EntrySectionView, type EntryEditor } from "./EntrySection";
import { sendJson, useLoaded } from "./recordApi";

// Page 1 and 7.1 of the Student Mentoring Record. Everything the student's own record holds is
// shown as it is (and can only be changed there); a detail that is missing can be filled in here,
// and is kept separately from the student's record.

function SourceTag({ field }: { field: RecordFieldView }) {
  if (field.source === "HOD") return <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">Edited by HOD</Badge>;
  if (field.source === "MENTOR") return <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">Added by mentor</Badge>;
  if (field.source === "STUDENT" || field.source === "DERIVED") {
    return <Lock className="h-3 w-3 text-muted-foreground/60 print:hidden" aria-label="From the student's record" />;
  }
  return null;
}

function FieldInput({ field, value, onChange, qualification = "" }: { field: RecordFieldView; value: string; onChange: (v: string) => void; qualification?: string }) {
  if (field.key === "category") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9"><SelectValue placeholder="Choose" /></SelectTrigger>
        <SelectContent>{CATEGORY_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
      </Select>
    );
  }
  if (field.key === "previousQualification") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9"><SelectValue placeholder="Choose" /></SelectTrigger>
        <SelectContent>{QUALIFICATION_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
      </Select>
    );
  }
  if (field.key === "entranceType") {
    // EAPCET follows Class XII (Intermediate), ECET follows a Diploma; once the route is known only its exam is offered.
    const only = qualification.startsWith("Diploma") ? ["ECET"] : qualification.startsWith("Intermediate") ? ["EAPCET"] : ["EAPCET", "ECET"];
    const options = [...only, ...(value && !only.includes(value.toUpperCase()) ? [value] : [])];
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9"><SelectValue placeholder="Choose" /></SelectTrigger>
        <SelectContent>{options.map((o) => <SelectItem key={o} value={o}>{o === "EAPCET" ? "EAPCET (after Class XII)" : o === "ECET" ? "ECET (after Diploma)" : o}</SelectItem>)}</SelectContent>
      </Select>
    );
  }
  if (field.key === "hosteller") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9"><SelectValue placeholder="Choose" /></SelectTrigger>
        <SelectContent>{["Yes", "No"].map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
      </Select>
    );
  }
  if (field.kind === "address") {
    return <Textarea value={value} rows={2} maxLength={500} placeholder="Not on record - add it" onChange={(e) => onChange(e.target.value)} />;
  }
  const isYear = field.key.endsWith("YearOfPass") || field.key === "entranceYear";
  const isRank = field.key === "entranceRank";
  const isPercent = field.key.endsWith("Percentage");
  return (
    <Input
      className="h-9"
      type={field.kind === "date" ? "date" : "text"}
      inputMode={field.kind === "phone" ? "tel" : field.kind === "email" ? "email" : isYear || isRank ? "numeric" : isPercent ? "decimal" : undefined}
      value={value}
      maxLength={field.kind === "phone" ? 13 : isYear ? 4 : isRank ? 7 : isPercent ? 6 : 200}
      placeholder={isYear ? "YYYY" : isPercent ? "0 - 100" : "Not on record - add it"}
      // Year and percentage take digits only (a percentage may have a decimal point).
      onChange={(e) => onChange(isYear || isRank ? e.target.value.replace(/\D/g, "") : isPercent ? e.target.value.replace(/[^\d.]/g, "") : e.target.value)}
    />
  );
}

function FieldCell({ field, draft, setDraft, qualification }: { field: RecordFieldView; draft: string | undefined; setDraft: (key: string, v: string) => void; qualification: string }) {
  // A value that is already on record is shown as text; the pencil (HOD, or the mentor for their own entry) opens it for editing.
  const [editing, setEditing] = useState(false);
  const open = field.editable && (!field.value || editing || draft !== undefined);
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        <span>{field.label}{field.required ? " *" : ""}</span>
        <SourceTag field={field} />
      </div>
      {open
        ? <FieldInput field={field} value={draft ?? field.value} qualification={qualification} onChange={(v) => setDraft(field.key, v)} />
        : (
          <div className="flex items-start gap-1.5">
            <p className="text-sm break-words whitespace-pre-wrap min-h-5 min-w-0 flex-1">{field.value || <span className="text-muted-foreground">—</span>}</p>
            {field.editable && (
              <button type="button" aria-label={`Edit ${field.label}`} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground print:hidden" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
    </div>
  );
}

function QualifyingCell({ field, draft, setDraft }: { field: RecordFieldView; draft: string | undefined; setDraft: (key: string, v: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (field.editable && (!field.value || editing || draft !== undefined)) {
    return <FieldInput field={field} value={draft ?? field.value} onChange={(v) => setDraft(field.key, v)} />;
  }
  return (
    <span className="flex items-start gap-1">
      <span className="break-words">{field.value || <span className="text-muted-foreground">—</span>}</span>
      {field.editable && (
        <button type="button" aria-label={`Edit ${field.label}`} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground print:hidden" onClick={() => setEditing(true)}>
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

// "Any guardian?" first; the guardian form and the Add guardian button appear only for Yes (or once one is on record).
function GuardiansCard({ api, entries, editor }: { api: string; entries: MentoringEntry[]; editor: EntryEditor }) {
  const section = entrySection("guardians");
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);
  if (!section) return null;
  const hasRows = entries.some((e) => e.section === "guardians");
  const showForm = hasRows || answer === "yes";
  if (showForm) return <EntrySectionView section={section} entries={entries} api={api} editor={editor} />;
  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <div>
          <h3 className="text-base font-semibold leading-tight">{section.title}</h3>
          {section.hint && <p className="text-xs text-muted-foreground mt-0.5">{section.hint}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">Does the student have a guardian?</span>
          <Button size="sm" variant="outline" onClick={() => setAnswer("yes")}>Yes</Button>
          <Button size="sm" variant={answer === "no" ? "default" : "outline"} onClick={() => setAnswer("no")}>No</Button>
        </div>
        {answer === "no" && <p className="text-sm text-muted-foreground">No guardian.</p>}
      </CardContent>
    </Card>
  );
}

export function StudentInfoPage({ api, entries, editor }: { api: string; entries: MentoringEntry[]; editor: EntryEditor }) {
  const { data, error, loading, setData } = useLoaded<MentoringRecordProfile>(`${api}?part=record`);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const allFields = useMemo(
    () => data ? [...data.groups.flatMap((g) => g.fields), ...data.qualifying.flatMap((q) => [q.institution, q.yearOfPass, q.board, q.percentage])] : [],
    [data]
  );
  // Only what differs from what is stored is sent.
  const changes = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of allFields) {
      if (!f.editable || !(f.key in drafts)) continue;
      if (drafts[f.key].trim() !== f.value) out[f.key] = drafts[f.key].trim();
    }
    return out;
  }, [allFields, drafts]);
  const changeCount = Object.keys(changes).length;

  const setDraft = (key: string, v: string) => setDrafts((d) => ({ ...d, [key]: v }));

  async function save() {
    setSaving(true);
    try {
      const d = await sendJson<MentoringRecordProfile>(`${api}/record/profile`, "PATCH", { values: changes });
      setData(d);
      setDrafts({});
      toast({ title: "Details saved" });
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setSaving(false);
    }
  }

  // Hostel name / room show as soon as "Hosteller" is Yes, saved or not.
  const hostellerField = allFields.find((x) => x.key === "hosteller");
  const isHostellerNow = (drafts.hosteller ?? hostellerField?.value ?? "").trim().toUpperCase() === "YES";

  // Rank, year and hall ticket show once an entrance exam is chosen (saved or not).
  const entranceField = allFields.find((x) => x.key === "entranceType");
  const entranceNow = (drafts.entranceType ?? entranceField?.value ?? "").trim().toUpperCase();
  // The route (Intermediate or Diploma) comes from the student's record; only that qualifying row is shown
  // (a row that already holds data stays visible). Until the route is known, both are.
  const qualificationField = allFields.find((x) => x.key === "previousQualification");
  const qualificationNow = (drafts.previousQualification ?? qualificationField?.value ?? "").trim();
  const qualifyingRows = (data?.qualifying ?? []).filter((q) => {
    if (q.prefix === "ssc" || !qualificationNow) return true;
    if ([q.institution, q.yearOfPass, q.board, q.percentage].some((x) => x.value)) return true;
    return q.prefix === (qualificationNow.startsWith("Diploma") ? "diploma" : "inter");
  });

  if (loading && !data) return <p className="text-sm text-muted-foreground py-6">Loading…</p>;
  if (error && !data) return <p className="text-sm text-muted-foreground py-6">{error}</p>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      {data.missingCount > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-sm print:hidden">
          <Info className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
          <p>
            <strong>{data.missingCount} detail{data.missingCount === 1 ? " is" : "s are"} missing</strong> on the student&apos;s record. Fill them in below as the student tells you.
            Details already on the student&apos;s record (<Lock className="inline h-3 w-3 -mt-0.5" />) are changed from their profile, not here.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground print:hidden"><Lock className="inline h-3 w-3 -mt-0.5" /> Details are read from the student&apos;s own record.</p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {data.groups.map((g) => (
          <Card key={g.id} className={g.id === "student" ? "lg:col-span-2" : ""}>
            <CardHeader className="pb-2"><CardTitle className="text-base">{g.title}</CardTitle></CardHeader>
            <CardContent>
              <div className={`grid gap-x-4 gap-y-3 ${g.id === "student" ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2"}`}>
                {g.fields.filter((f) => (g.id !== "hostel" || f.key === "hosteller" || isHostellerNow) && (g.id !== "entrance" || f.key === "entranceType" || entranceNow)).map((f) => (
                  <div key={f.key} className={f.kind === "address" ? "sm:col-span-2" : ""}>
                    <FieldCell field={f} draft={drafts[f.key]} setDraft={setDraft} qualification={qualificationNow} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Details of qualifying examination</CardTitle>
          <p className="text-xs text-muted-foreground">From the student&apos;s previous-education details. Diploma is for diploma (lateral entry) students.</p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3 font-medium w-24">Exam</th>
                <th className="py-2 pr-3 font-medium">Name of the institution</th>
                <th className="py-2 pr-3 font-medium w-28">Year of passing</th>
                <th className="py-2 pr-3 font-medium w-40">Board</th>
                <th className="py-2 font-medium w-28">% of marks</th>
              </tr>
            </thead>
            <tbody>
              {qualifyingRows.map((q) => (
                <tr key={q.prefix} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-3 font-medium">{q.exam}</td>
                  {[q.institution, q.yearOfPass, q.board, q.percentage].map((f) => (
                    <td key={f.key} className="py-2 pr-3 last:pr-0">
                      <QualifyingCell field={f} draft={drafts[f.key]} setDraft={setDraft} />
                      {(f.source === "MENTOR" || f.source === "HOD") && <div className="mt-0.5"><SourceTag field={f} /></div>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <GuardiansCard api={api} entries={entries} editor={editor} />
      {entrySection("siblings") &&<EntrySectionView section={entrySection("siblings")!} entries={entries} api={api} editor={editor} />}
      {entrySection("addressChanges") && <EntrySectionView section={entrySection("addressChanges")!} entries={entries} api={api} editor={editor} />}

      {(data.otherGroups?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <div>
            <h3 className="text-base font-semibold leading-tight">Other details on the student&apos;s record</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Read-only. The College Office keeps these (Students → Import → Update student data) and the student can update some of them.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {(data.otherGroups ?? []).map((g) => (
              <Card key={g.title} className="break-inside-avoid">
                <CardHeader className="pb-2"><CardTitle className="text-base">{g.title}</CardTitle></CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-[minmax(0,40%)_1fr] gap-x-3 gap-y-1.5 text-sm">
                    {g.rows.map((r) => (
                      <div key={r.label} className="contents">
                        <dt className="text-muted-foreground">{r.label}</dt>
                        <dd className={`break-words ${r.value ? "" : "text-muted-foreground/60"}`}>{r.value || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {changeCount > 0 && (
        <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-lg border bg-background/95 backdrop-blur px-4 py-2.5 shadow-lg print:hidden">
          <span className="text-sm">{changeCount} unsaved change{changeCount === 1 ? "" : "s"}</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => setDrafts({})}>Discard</Button>
            <Button size="sm" disabled={saving} onClick={save}><Save className="h-4 w-4 mr-1" /> {saving ? "Saving…" : "Save details"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
