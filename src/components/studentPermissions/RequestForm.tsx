"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { StudentPicker } from "./StudentPicker";
import { createRequest, loadOptions, uploadProof, type FormOptions, type PickerStudent } from "./api";

// Raise a permission request: a student for themselves ("student" mode), or
// faculty for a group of students ("faculty" mode). What is offered - the types,
// whether proof is needed, the longest span - comes from the server, resolved for
// the department; the server re-checks everything on submit.

const PERIOD_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8];
const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** Hours from now to the start of `fromDate` (IST). Negative = already under way / past. */
function hoursUntil(fromDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return null;
  return (new Date(`${fromDate}T00:00:00+05:30`).getTime() - Date.now()) / 3_600_000;
}

export function RequestForm({ mode, onCreated }: { mode: "student" | "faculty"; onCreated: () => void }) {
  const [options, setOptions] = useState<FormOptions | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [venue, setVenue] = useState("");
  const [fromDate, setFromDate] = useState(todayISO());
  const [toDate, setToDate] = useState(todayISO());
  const [allPeriods, setAllPeriods] = useState(true);
  const [periods, setPeriods] = useState<number[]>([]);
  const [proof, setProof] = useState<{ url: string; name: string }[]>([]);
  const [students, setStudents] = useState<PickerStudent[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadOptions().then(setOptions).catch((e) => toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't load the form" })); }, []);

  const limits = options?.limits;
  const hours = hoursUntil(fromDate);
  const short = hours !== null && limits ? hours < limits.advanceNoticeHours : false;
  const needsProof = limits?.proofRequired ?? true;
  const days = useMemo(() => {
    if (!fromDate || !toDate || toDate < fromDate) return 0;
    return Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86_400_000) + 1;
  }, [fromDate, toDate]);

  async function onFile(files: FileList | null) {
    if (!files?.length) return;
    if (proof.length + files.length > 5) { toast({ variant: "destructive", title: "At most 5 proof files" }); return; }
    setUploading(true);
    try {
      const uploaded: { url: string; name: string }[] = [];
      for (const f of Array.from(files)) uploaded.push(await uploadProof(f));
      setProof((p) => [...p, ...uploaded]);
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Upload failed" }); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  const problem = (() => {
    if (!categoryId) return "Choose a permission type";
    if (!title.trim()) return "Add a short title";
    if (!description.trim()) return "Describe the purpose";
    if (!fromDate || !toDate || toDate < fromDate) return "Check the dates";
    if (limits && days > limits.maxDays) return `At most ${limits.maxDays} days per request`;
    if (!allPeriods && periods.length === 0) return "Choose the periods, or pick all periods";
    if (needsProof && proof.length === 0) return "Attach proof (an invitation, registration or letter)";
    if (mode === "faculty" && students.length === 0) return "Select at least one student";
    return null;
  })();

  async function submit() {
    if (problem) { toast({ variant: "destructive", title: problem }); return; }
    setSubmitting(true);
    try {
      const created = await createRequest({
        categoryId, title, description, venue, fromDate, toDate, periods: allPeriods ? "ALL" : periods, proof,
        ...(mode === "faculty" ? { studentIds: students.map((s) => s.id) } : {}),
      });
      toast({ variant: "success", title: created.length > 1 ? `${created.length} requests sent (one per department)` : "Request sent", description: "You'll be notified when it's decided." });
      setTitle(""); setDescription(""); setVenue(""); setProof([]); setStudents([]); setPeriods([]); setAllPeriods(true);
      onCreated();
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't send the request" }); }
    finally { setSubmitting(false); }
  }

  if (!options) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!options.enabled) return <p className="text-sm text-muted-foreground">Student permissions aren&apos;t switched on for this college yet.</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{mode === "student" ? "Request permission" : "Request permission for students"}</CardTitle>
        <CardDescription>
          Once approved, the covered students are shown <strong>On Duty</strong> for those periods and the periods are left out of their attendance percentage.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Type of permission</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="Choose a type" /></SelectTrigger>
              <SelectContent className="max-h-80">
                {options.groups.map((g) => (
                  <SelectGroup key={g.id}>
                    <SelectLabel>{g.label}</SelectLabel>
                    {g.items.map((i) => <SelectItem key={i.id} value={i.id} disabled={!i.enabled}>{i.label}{i.enabled ? "" : " (off)"}</SelectItem>)}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pm-title">Title</Label>
            <Input id="pm-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Smart India Hackathon - finals" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pm-desc">Purpose</Label>
          <Textarea id="pm-desc" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is it, who organises it, why attending?" />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="pm-from">From</Label>
            <Input id="pm-from" type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); if (toDate < e.target.value) setToDate(e.target.value); }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pm-to">To</Label>
            <Input id="pm-to" type="date" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pm-venue">Venue (optional)</Label>
            <Input id="pm-venue" value={venue} maxLength={200} onChange={(e) => setVenue(e.target.value)} />
          </div>
        </div>

        {short && (
          <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>
              {hours !== null && hours < 0 ? "This starts today or has already started. " : "Short notice. "}
              It&apos;s best to request at least {limits?.advanceNoticeHours ?? 24} hours before. You can still send it - it will be marked as late.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label>Periods</Label>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={allPeriods} onCheckedChange={(c) => setAllPeriods(!!c)} />All periods on those days</label>
          {!allPeriods && (
            <div className="flex flex-wrap gap-3">
              {PERIOD_CHOICES.map((p) => (
                <label key={p} className="flex items-center gap-1.5 text-sm">
                  <Checkbox checked={periods.includes(p)} onCheckedChange={(c) => setPeriods((cur) => (c ? [...cur, p].sort((a, b) => a - b) : cur.filter((x) => x !== p)))} />{p}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>Proof {needsProof ? <span className="text-destructive">*</span> : <span className="text-muted-foreground">(optional)</span>}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" multiple className="hidden" onChange={(e) => void onFile(e.target.files)} />
            <Button type="button" variant="outline" size="sm" disabled={uploading || proof.length >= 5} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileUp className="h-4 w-4 mr-2" />}Upload PDF / image
            </Button>
            <span className="text-xs text-muted-foreground">PDF, PNG or JPEG, up to 4 MB each</span>
          </div>
          {proof.map((p, i) => (
            <div key={p.url} className="flex items-center gap-2 text-sm">
              <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">{p.name}</a>
              <button type="button" aria-label={`Remove ${p.name}`} className="text-muted-foreground hover:text-destructive" onClick={() => setProof((cur) => cur.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button>
            </div>
          ))}
        </div>

        {mode === "faculty" && <StudentPicker selected={students} onChange={setStudents} max={limits?.maxStudentsPerRequest ?? 100} />}

        <div className="flex items-center justify-end gap-3">
          {problem && <p className="text-xs text-muted-foreground">{problem}</p>}
          <Button onClick={() => void submit()} loading={submitting} disabled={!!problem}>Send request</Button>
        </div>
      </CardContent>
    </Card>
  );
}
