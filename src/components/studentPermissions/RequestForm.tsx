"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileUp, Inbox, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { StudentPicker } from "./StudentPicker";
import {
  createRequest,
  loadOptions,
  uploadProof,
  type FormOptions,
  type PickerStudent,
} from "./api";
import { EmptyState, ListSkeleton } from "./statusBadge";

// Raise a permission request: a student for themselves ("student" mode), or
// faculty for a group of students ("faculty" mode). What is offered - the types,
// whether proof is needed, the longest span - comes from the server, resolved for
// the department; the server re-checks everything on submit.

const PERIOD_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8];
const todayISO = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** Hours from now to the start of `fromDate` (IST). Negative = already under way / past. */
function hoursUntil(fromDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return null;
  return (
    (new Date(`${fromDate}T00:00:00+05:30`).getTime() - Date.now()) / 3_600_000
  );
}

const Required = () => (
  <span className="text-destructive ml-0.5" aria-hidden>
    *
  </span>
);

// A quiet divider heading that breaks the long form into steps a person can scan on a phone.
const Section = ({ children }: { children: React.ReactNode }) => (
  <h3 className="border-b pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
    {children}
  </h3>
);

export function RequestForm({
  mode,
  onCreated,
}: {
  mode: "student" | "faculty";
  onCreated: () => void;
}) {
  const [options, setOptions] = useState<FormOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [otherCategory, setOtherCategory] = useState("");
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

  useEffect(() => {
    loadOptions()
      .then(setOptions)
      .catch((e) =>
        setOptionsError(
          e instanceof Error ? e.message : "Couldn't load the form",
        ),
      );
  }, []);

  const limits = options?.limits;
  const hours = hoursUntil(fromDate);
  const short =
    hours !== null && limits ? hours < limits.advanceNoticeHours : false;
  const isOtherCategory = categoryId.startsWith("other");
  const needsProof =
    options?.proofRequiredByCategory?.[categoryId] ??
    limits?.proofRequired ??
    true;

  const days = useMemo(() => {
    if (!fromDate || !toDate || toDate < fromDate) return 0;
    return (
      Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86_400_000) + 1
    );
  }, [fromDate, toDate]);

  async function onFile(files: FileList | null) {
    if (!files?.length) return;
    if (proof.length + files.length > 5) {
      toast({ variant: "destructive", title: "At most 5 proof files" });
      return;
    }
    setUploading(true);
    try {
      const uploaded: { url: string; name: string }[] = [];
      for (const f of Array.from(files)) uploaded.push(await uploadProof(f));
      setProof((p) => [...p, ...uploaded]);
    } catch (e) {
      toast({
        variant: "destructive",
        title: e instanceof Error ? e.message : "Upload failed",
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const problems = useMemo(() => {
    const out: string[] = [];
    if (categoryId && isOtherCategory && !otherCategory.trim())
      out.push("Specify the custom permission type");
    if (title && !title.trim()) out.push("Add a short title");
    if (fromDate && toDate && toDate < fromDate)
      out.push("The end date cannot be before the start date");
    if (
      limits &&
      fromDate &&
      toDate &&
      toDate >= fromDate &&
      days > limits.maxDays
    )
      out.push(`At most ${limits.maxDays} days per request`);
    if (!allPeriods && periods.length === 0)
      out.push("Choose the periods, or pick all periods");
    return out;
  }, [
    categoryId,
    isOtherCategory,
    otherCategory,
    title,
    fromDate,
    toDate,
    limits,
    days,
    allPeriods,
    periods,
  ]);

  const requiredMissing = (() => {
    if (!categoryId) return "Choose a permission type";
    if (isOtherCategory && !otherCategory.trim())
      return "Specify the custom permission type";
    if (!title.trim()) return "Add a short title";
    if (!description.trim()) return "Describe the purpose";
    if (!fromDate || !toDate || toDate < fromDate) return "Check the dates";
    if (!allPeriods && periods.length === 0)
      return "Choose the periods, or pick all periods";
    if (needsProof && proof.length === 0)
      return "Attach proof (an invitation, registration or letter)";
    if (mode === "faculty" && students.length === 0)
      return "Select at least one student";
    return null;
  })();

  async function submit() {
    if (requiredMissing) {
      toast({ variant: "destructive", title: requiredMissing });
      return;
    }
    setSubmitting(true);
    try {
      const created = await createRequest({
        categoryId,
        ...(isOtherCategory && otherCategory.trim()
          ? { otherCategory: otherCategory.trim() }
          : {}),
        title,
        description,
        venue,
        fromDate,
        toDate,
        periods: allPeriods ? "ALL" : periods,
        proof,
        ...(mode === "faculty"
          ? { studentIds: students.map((s) => s.id) }
          : {}),
      });
      toast({
        variant: "success",
        title:
          created.length > 1
            ? `${created.length} requests sent (one per department)`
            : "Request sent",
        description: "You will be notified when a decision is made.",
      });
      setTitle("");
      setOtherCategory("");
      setDescription("");
      setVenue("");
      setProof([]);
      setStudents([]);
      setPeriods([]);
      setAllPeriods(true);
      onCreated();
    } catch (e) {
      toast({
        variant: "destructive",
        title: e instanceof Error ? e.message : "Couldn't send the request",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (optionsError)
    return (
      <EmptyState
        icon={Inbox}
        headline="Couldn't load the request form."
        hint={optionsError}
      />
    );
  if (!options) return <ListSkeleton rows={2} />;
  if (!options.enabled)
    return (
      <EmptyState
        icon={Inbox}
        headline="Student permissions are not enabled for this college."
        hint="The Principal can enable them under Routing."
      />
    );

  return (
    <Card className="border shadow-xs">
      <CardHeader className="p-4 pb-2 sm:p-6 sm:pb-3">
        <CardTitle className="text-base">
          {mode === "student"
            ? "Request Permission"
            : "Request Permission for Students"}
        </CardTitle>
        <CardDescription>
          Once approved, covered students are marked On Duty for selected dates
          and periods.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-2 sm:space-y-5 sm:p-6 sm:pt-3">
        {mode === "student" && options.studentInfo && (
          <div className="rounded-md border bg-muted/40 p-3 text-xs sm:text-sm">
            <span className="font-semibold text-foreground">
              Applying for Section:{" "}
            </span>
            <span className="font-medium text-foreground">
              {options.studentInfo.department}
            </span>
            <span className="mx-1 text-muted-foreground" aria-hidden>
              •
            </span>
            <span>Year {options.studentInfo.year}</span>
            <span className="mx-1 text-muted-foreground" aria-hidden>
              •
            </span>
            <span className="font-medium">
              Section {options.studentInfo.section}
            </span>
            <span className="ml-2 text-muted-foreground">
              ({options.studentInfo.name} - {options.studentInfo.rollNumber})
            </span>
          </div>
        )}

        <Section>1 · What is it for</Section>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>
              Type of permission
              <Required />
            </Label>
            <Select
              value={categoryId}
              onValueChange={(val) => {
                setCategoryId(val);
                if (!val.startsWith("other")) setOtherCategory("");
              }}
            >
              <SelectTrigger aria-required>
                <SelectValue placeholder="Choose a type" />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {options.groups.map((g) => (
                  <SelectGroup key={g.id}>
                    <SelectLabel>{g.label}</SelectLabel>
                    {g.items.map((i) => (
                      <SelectItem key={i.id} value={i.id} disabled={!i.enabled}>
                        {i.label}
                        {i.enabled ? "" : " (off)"}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pm-title">
              Title
              <Required />
            </Label>
            <Input
              id="pm-title"
              value={title}
              maxLength={120}
              required
              aria-describedby={
                title && !title.trim() ? "pm-title-error" : undefined
              }
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Smart India Hackathon"
            />
            {title && !title.trim() && (
              <p
                id="pm-title-error"
                className="text-xs text-destructive"
                role="alert"
              >
                Title cannot be only spaces.
              </p>
            )}
          </div>
        </div>

        {isOtherCategory && (
          <div className="space-y-1.5">
            <Label htmlFor="pm-other-type">
              Specify Permission Type
              <Required />
            </Label>
            <Input
              id="pm-other-type"
              value={otherCategory}
              maxLength={120}
              required
              onChange={(e) => setOtherCategory(e.target.value)}
              placeholder="e.g. Blood Donation Camp, NSS Event, Paper Presentation"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="pm-desc">
            Purpose
            <Required />
          </Label>
          <Textarea
            id="pm-desc"
            rows={3}
            maxLength={2000}
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the purpose of permission request"
            aria-describedby="pm-desc-count"
          />
          <p
            id="pm-desc-count"
            className="text-xs text-muted-foreground text-right"
          >
            {description.length}/2000
          </p>
        </div>

        <Section>2 · When</Section>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="pm-from">
              From
              <Required />
            </Label>
            <Input
              id="pm-from"
              type="date"
              required
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                if (toDate < e.target.value) setToDate(e.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pm-to">
              To
              <Required />
            </Label>
            <Input
              id="pm-to"
              type="date"
              required
              value={toDate}
              min={fromDate}
              aria-invalid={!!fromDate && !!toDate && toDate < fromDate}
              onChange={(e) => setToDate(e.target.value)}
            />
            {toDate < fromDate && (
              <p className="text-xs text-destructive" role="alert">
                End date is before the start date.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pm-venue">Venue (optional)</Label>
            <Input
              id="pm-venue"
              value={venue}
              maxLength={200}
              onChange={(e) => setVenue(e.target.value)}
            />
          </div>
        </div>

        {short && (
          <div
            className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs sm:text-sm text-amber-900"
            role="status"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
            <p>
              {hours !== null && hours < 0
                ? "This request starts today or has passed. "
                : "Short notice request. "}
              Requests are recommended at least{" "}
              {limits?.advanceNoticeHours ?? 24} hours prior. It will be
              submitted and flagged as short notice.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label>
            Periods
            <Required />
          </Label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm sm:min-h-10">
            <Checkbox
              checked={allPeriods}
              onCheckedChange={(c) => setAllPeriods(!!c)}
            />
            All periods on selected days
          </label>
          {!allPeriods && (
            <div
              className="grid grid-cols-4 gap-2 pt-1 sm:grid-cols-8"
              role="group"
              aria-label="Select periods"
            >
              {PERIOD_CHOICES.map((p) => (
                <label
                  key={p}
                  className={`flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md border text-sm transition-colors sm:min-h-10 ${
                    periods.includes(p)
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <Checkbox
                    checked={periods.includes(p)}
                    onCheckedChange={(c) =>
                      setPeriods((cur) =>
                        c
                          ? [...cur, p].sort((a, b) => a - b)
                          : cur.filter((x) => x !== p),
                      )
                    }
                    aria-label={`Period ${p}`}
                  />
                  {p}
                </label>
              ))}
            </div>
          )}
        </div>

        <Section>3 · Proof{mode === "faculty" ? " and students" : ""}</Section>
        <div className="space-y-2">
          <Label>
            Proof{" "}
            {needsProof ? (
              <Required />
            ) : (
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            )}
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              multiple
              className="hidden"
              onChange={(e) => void onFile(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 w-full sm:min-h-8 sm:w-auto"
              disabled={uploading || proof.length >= 5}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
              ) : (
                <FileUp className="h-4 w-4 mr-2" aria-hidden />
              )}
              {uploading ? "Uploading…" : "Upload File"}
            </Button>
            <span className="text-xs text-muted-foreground">
              PDF, PNG or JPEG (up to 4 MB each, at most 5 files)
            </span>
          </div>
          {proof.map((p, i) => (
            <div
              key={p.url}
              className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 pl-3 text-sm"
            >
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 truncate py-2 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                {p.name}
              </a>
              <button
                type="button"
                aria-label={`Remove ${p.name}`}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:w-9"
                onClick={() => setProof((cur) => cur.filter((_, j) => j !== i))}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>

        {mode === "faculty" && (
          <StudentPicker
            selected={students}
            onChange={setStudents}
            max={limits?.maxStudentsPerRequest ?? 100}
          />
        )}

        {/* On a phone the Send button stays pinned to the bottom of the screen with the reason it is disabled. */}
        <div className="sticky bottom-2 z-10 flex flex-col gap-2 rounded-lg border bg-background/95 p-3 shadow-md backdrop-blur sm:static sm:flex-row sm:items-center sm:justify-end sm:gap-3 sm:border-0 sm:bg-transparent sm:p-0 sm:pt-2 sm:shadow-none sm:backdrop-blur-none">
          {problems.length > 0 ? (
            <p
              className="text-xs text-amber-700 text-center sm:text-right"
              role="alert"
            >
              {problems.join(" · ")}
            </p>
          ) : (
            requiredMissing && (
              <p className="text-xs text-muted-foreground text-center sm:text-right">
                {requiredMissing}
              </p>
            )
          )}
          <Button
            onClick={() => void submit()}
            loading={submitting}
            disabled={!!requiredMissing || problems.length > 0}
            className="min-h-11 w-full sm:min-h-9 sm:w-auto"
          >
            Send Request
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
