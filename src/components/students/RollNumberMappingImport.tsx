"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { Download, Upload, CheckCircle2, XCircle, FileSpreadsheet, ArrowLeft, AlertTriangle, KeyRound, Search } from "lucide-react";
import { parseCSV, parseExcelFile, readFileAsText, toCSV, downloadCSV } from "@/lib/utils/csv";
import type { RollMapOutcome, RollMapResult } from "@/lib/students/rollMapping";

// Maps EXISTING students to their Roll No, matched on Student Mobile No.
// Deliberately separate from the "Add students" import beside it: that one
// creates students, this one only fills in a field on students already there.
// It never creates, never deletes, and never clears a roll.
//
// Laid out as the same numbered-step flow as that import - template, upload,
// preview, act - so the Office is not learning a second page.

const HEADERS = ["Student Mobile No", "Roll No", "Name"];
const SAMPLE: string[][] = [
  HEADERS,
  ["9876543210", "22A91A0501", "Optional - only warns about a mismatch"],
];

const HINTS = [
  "Student Mobile No is how each row finds its student - it must be the number already on their record.",
  "Roll No is what will be set. Roll numbers are unique across every college.",
  "Name is optional. It only warns you about a mismatch; it is never matched on and never written.",
  "A student who already has this exact roll is skipped, so re-running the same file is safe.",
  "Nothing is written until you press Apply - check the preview first.",
  "A roll number is never cleared or deleted by this import.",
];

const OUTCOME_LABELS: { key: RollMapOutcome; label: string; tone: "good" | "warn" | "bad" }[] = [
  { key: "WILL_SET", label: "Will set roll", tone: "good" },
  { key: "ALREADY_SET", label: "Already has this roll", tone: "good" },
  { key: "DIFFERENT_ROLL", label: "Has a different roll", tone: "warn" },
  { key: "NO_MATCH", label: "No student with this mobile", tone: "bad" },
  { key: "MOBILE_SHARED", label: "Mobile shared by two students", tone: "bad" },
  { key: "ROLL_TAKEN", label: "Roll already used", tone: "bad" },
  { key: "DUPLICATE_IN_FILE", label: "Same roll twice in the file", tone: "bad" },
  { key: "BAD_ROLL", label: "Roll No unusable", tone: "bad" },
  { key: "BAD_MOBILE", label: "Mobile No unusable", tone: "bad" },
];

interface PreviewResponse { results?: RollMapResult[]; error?: string }
interface ApplyResponse {
  appliedCount?: number; failedCount?: number; skippedCount?: number;
  applied?: RollMapResult[]; failed?: (RollMapResult & { error: string })[]; skipped?: RollMapResult[];
  error?: string;
}

export function RollNumberMappingImport() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<{ rowNumber: number; mobile: string; roll: string; name?: string }[]>([]);
  const [parseError, setParseError] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(false);

  const [results, setResults] = useState<RollMapResult[] | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResponse | null>(null);

  const [password, setPassword] = useState("");
  const [isCreatingLogins, setIsCreatingLogins] = useState(false);

  const summary = useMemo(() => {
    const counts = Object.fromEntries(OUTCOME_LABELS.map((o) => [o.key, 0])) as Record<RollMapOutcome, number>;
    for (const r of results ?? []) counts[r.outcome]++;
    return counts;
  }, [results]);

  const willSet = summary.WILL_SET ?? 0;
  const nameMismatches = (results ?? []).filter((r) => r.nameMismatch).length;
  const backHref = "/college-office";

  // Any new file or changed option invalidates the preview and the last run - a
  // preview produced for one file must never be applied against another.
  function reset() {
    setResults(null);
    setApplyResult(null);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setParseError("");
    reset();
    setFileName(file.name);
    try {
      const grid = file.name.toLowerCase().endsWith(".csv")
        ? parseCSV(await readFileAsText(file))
        : await parseExcelFile(file);
      if (grid.length < 2) { setParseError("That file has no rows under the header."); setRows([]); return; }

      const header = grid[0].map((h) => h.trim().toLowerCase());
      const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
      const mobileAt = col("student mobile no", "mobile no", "mobile", "phone", "student mobile");
      const rollAt = col("roll no", "roll number", "rollno", "roll");
      const nameAt = col("name", "student name");

      if (mobileAt < 0 || rollAt < 0) {
        setParseError('The file needs a "Student Mobile No" column and a "Roll No" column.');
        setRows([]);
        return;
      }

      const parsed = grid.slice(1)
        .map((cells, i) => ({
          rowNumber: i + 2, // +2: 1-based, and the header is row 1
          mobile: (cells[mobileAt] ?? "").trim(),
          roll: (cells[rollAt] ?? "").trim(),
          ...(nameAt >= 0 ? { name: (cells[nameAt] ?? "").trim() } : {}),
        }))
        .filter((r) => r.mobile || r.roll); // drop blank trailing lines

      if (parsed.length === 0) { setParseError("Every row in that file is empty."); setRows([]); return; }
      setRows(parsed);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Could not read that file.");
      setRows([]);
    }
  }

  async function preview() {
    if (rows.length === 0) return;
    setIsPreviewing(true);
    try {
      const res = await fetch("/api/college/students/map-roll-numbers/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, replaceExisting }),
      });
      const json = (await res.json()) as PreviewResponse;
      if (!res.ok) throw new Error(json.error ?? "Could not check the file");
      setResults(json.results ?? []);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Could not check the file" });
    } finally {
      setIsPreviewing(false);
    }
  }

  async function apply() {
    if (!results || willSet === 0) return;
    setIsApplying(true);
    try {
      const res = await fetch("/api/college/students/map-roll-numbers/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, replaceExisting }),
      });
      const json = (await res.json()) as ApplyResponse;
      if (!res.ok) throw new Error(json.error ?? "Could not apply the roll numbers");
      setApplyResult(json);
      await preview(); // so the table shows what is now true and a second apply is a no-op
      toast({
        variant: (json.failedCount ?? 0) > 0 ? "destructive" : "success",
        title: `${json.appliedCount ?? 0} roll number(s) set`,
        ...((json.failedCount ?? 0) > 0 ? { description: `${json.failedCount} row(s) failed - download the results.` } : {}),
      });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Could not apply the roll numbers" });
    } finally {
      setIsApplying(false);
    }
  }

  function downloadResults() {
    const all = [
      ...(applyResult?.applied ?? []).map((r) => ({ r, status: "applied", error: "" })),
      ...(applyResult?.failed ?? []).map((r) => ({ r, status: "failed", error: r.error })),
      ...(applyResult?.skipped ?? []).map((r) => ({ r, status: "skipped", error: "" })),
    ].sort((a, b) => a.r.rowNumber - b.r.rowNumber);
    downloadCSV(
      toCSV([
        ["Row", "Student Mobile No", "Roll No", "Name", "Status", "Outcome", "Reason", "Student"],
        ...all.map(({ r, status, error }) => [
          String(r.rowNumber), r.mobile, r.roll, r.name ?? "",
          status, r.outcome, error || r.message, r.studentName ?? "",
        ]),
      ]),
      `import-roll-nos-results-${new Date().toISOString().slice(0, 10)}.csv`
    );
  }

  // Only students this run actually gave a roll to - not every roll-less
  // student in the college.
  const loginCandidates = (applyResult?.applied ?? []).map((r) => r.studentId).filter((v): v is string => !!v);

  async function createLogins() {
    if (loginCandidates.length === 0) return;
    setIsCreatingLogins(true);
    try {
      const res = await fetch("/api/college/students/bulk-create-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentIds: loginCandidates, password }),
      });
      const json = (await res.json()) as { created?: number; failed?: unknown[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Could not create logins");
      const failed = Array.isArray(json.failed) ? json.failed.length : 0;
      toast({
        variant: failed > 0 ? "destructive" : "success",
        title: `${json.created ?? 0} login(s) created`,
        ...(failed > 0 ? { description: `${failed} could not be created.` } : {}),
      });
      setPassword("");
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Could not create logins" });
    } finally {
      setIsCreatingLogins(false);
    }
  }

  const step = (n: number) => (
    <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">{n}</span>
  );

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Map Roll Numbers"
        description="Set Roll No on students already on the roster, matched by their Student Mobile No - nothing is written until you apply"
        actions={
          <Button variant="outline" asChild>
            <Link href={backHref}><ArrowLeft className="h-4 w-4 mr-1" />Back to Dashboard</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2">{step(1)}Download Template</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Download the template, fill in each student&rsquo;s mobile number and roll number, and upload it below.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-muted-foreground bg-muted/40 rounded-lg p-3">
            {HINTS.map((h) => (
              <p key={h} className="flex items-start gap-1"><span className="text-primary mt-0.5">•</span>{h}</p>
            ))}
          </div>
          <Button onClick={() => downloadCSV(toCSV(SAMPLE), "import-roll-nos-template.csv")} className="gap-2">
            <Download className="h-4 w-4" />Download Template (CSV)
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2">{step(2)}Upload Filled File</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => void handleFile(e)} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center gap-3 hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium text-sm">Click to select a CSV or Excel file</p>
              <p className="text-xs text-muted-foreground mt-1">.csv or .xlsx supported - needs a Student Mobile No and a Roll No column</p>
            </div>
          </button>
          {parseError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              {parseError}
            </div>
          )}
          {rows.length > 0 && (
            <p className="text-sm text-green-700 flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" />{fileName} - {rows.length} row{rows.length !== 1 ? "s" : ""} parsed successfully
            </p>
          )}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2">{step(3)}Check Against the Roster</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={replaceExisting} onCheckedChange={(v) => { setReplaceExisting(v === true); reset(); }} />
              <span>
                Replace a roll number a student already has
                <span className="block text-xs text-muted-foreground">
                  Off by default. With this off, a student who already holds a different roll is skipped.
                </span>
              </span>
            </label>
            <Button onClick={() => void preview()} loading={isPreviewing} className="gap-2">
              <Search className="h-4 w-4" />Check {rows.length} Row{rows.length !== 1 ? "s" : ""}
            </Button>
          </CardContent>
        </Card>
      )}

      {results && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                {step(4)}Preview ({results.length} rows)
              </CardTitle>
              {willSet === 0 && <Badge variant="destructive" className="text-xs">Nothing to apply</Badge>}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex flex-wrap gap-2 px-5 pb-3">
              {OUTCOME_LABELS.filter((o) => (summary[o.key] ?? 0) > 0).map((o) => (
                <Badge key={o.key} variant={o.tone === "good" ? "secondary" : o.tone === "warn" ? "in_progress" : "destructive"}>
                  {o.label}: {summary[o.key]}
                </Badge>
              ))}
            </div>
            {nameMismatches > 0 && (
              <div className="mx-5 mb-3 flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                {nameMismatches} row{nameMismatches !== 1 ? "s have" : " has"} a Name that does not match the student on file.
                They will still be applied - check them below first.
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left p-2 font-medium text-muted-foreground w-8">#</th>
                    <th className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">Student Mobile No</th>
                    <th className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">Roll No</th>
                    <th className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">Student</th>
                    <th className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">What happens</th>
                  </tr>
                </thead>
                <tbody>
                  {results.slice(0, 50).map((r, i) => (
                    <tr
                      key={r.rowNumber}
                      className={`border-b ${r.outcome === "WILL_SET" ? "" : r.outcome === "ALREADY_SET" ? (i % 2 === 0 ? "" : "bg-muted/20") : "bg-red-50"}`}
                    >
                      <td className="p-2 text-muted-foreground">{r.rowNumber}</td>
                      <td className="p-2 whitespace-nowrap">{r.mobile || <span className="text-muted-foreground/40">-</span>}</td>
                      <td className="p-2 whitespace-nowrap font-medium">{r.roll || <span className="text-muted-foreground/40">-</span>}</td>
                      <td className="p-2 whitespace-nowrap">
                        {r.studentName ?? <span className="text-muted-foreground/40">-</span>}
                        {r.currentRoll ? <span className="text-muted-foreground"> (now {r.currentRoll})</span> : null}
                        {r.nameMismatch && <span className="ml-1 text-amber-600">name differs</span>}
                      </td>
                      <td className={`p-2 ${r.outcome === "WILL_SET" ? "text-green-700 font-medium" : "text-muted-foreground"}`}>
                        {r.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {results.length > 50 && (
                <p className="text-xs text-muted-foreground p-3 border-t">
                  Showing first 50 of {results.length} rows. All rows are included when you apply.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {results && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2">{step(5)}Apply</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {willSet === 0 && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                No row in this file needs applying. Everything is either already set or skipped for the reason shown above.
              </div>
            )}
            <div className="flex gap-3">
              <Button onClick={() => void apply()} loading={isApplying} disabled={willSet === 0}>
                <Upload className="h-4 w-4 mr-2" />
                Set {willSet} Roll Number{willSet !== 1 ? "s" : ""}
              </Button>
              <Button variant="outline" onClick={() => { setRows([]); setFileName(""); reset(); }}>
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {applyResult && (
        <Card className={(applyResult.appliedCount ?? 0) > 0 && (applyResult.failedCount ?? 0) === 0 ? "border-green-200" : "border-red-200"}>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              {(applyResult.failedCount ?? 0) === 0
                ? <CheckCircle2 className="h-5 w-5 text-green-600" />
                : <XCircle className="h-5 w-5 text-red-600" />}
              <p className="font-medium">
                {applyResult.appliedCount ?? 0} roll number{(applyResult.appliedCount ?? 0) !== 1 ? "s" : ""} set
                {(applyResult.failedCount ?? 0) > 0 && <span className="text-red-600"> &middot; {applyResult.failedCount} failed</span>}
                <span className="text-muted-foreground font-normal"> &middot; {applyResult.skippedCount ?? 0} skipped</span>
              </p>
            </div>
            {(applyResult.failed ?? []).length > 0 && (
              <div className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {(applyResult.failed ?? []).slice(0, 10).map((f) => (
                  <p key={f.rowNumber}>Row {f.rowNumber} ({f.roll}): {f.error}</p>
                ))}
                {(applyResult.failed ?? []).length > 10 && (
                  <p className="text-xs">...and {(applyResult.failed ?? []).length - 10} more - download the results.</p>
                )}
              </div>
            )}
            <Button variant="outline" size="sm" onClick={downloadResults} className="gap-2">
              <Download className="h-4 w-4" />Download Results
            </Button>
          </CardContent>
        </Card>
      )}

      {(applyResult?.appliedCount ?? 0) > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2">{step(6)}Create Logins (optional)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Create logins for the {loginCandidates.length} student{loginCandidates.length !== 1 ? "s" : ""} this run gave a
              roll number to. They sign in with their Roll No and this password, and can change it afterwards.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="roll-map-password" className="text-xs">Password for all of them</Label>
                <Input
                  id="roll-map-password"
                  type="password"
                  autoComplete="new-password"
                  className="w-64"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 8 characters"
                />
              </div>
              <Button onClick={() => void createLogins()} loading={isCreatingLogins} disabled={password.length < 8} className="gap-2">
                <KeyRound className="h-4 w-4" />Create Logins
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
