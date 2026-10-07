"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumInput, TextInput } from "@/components/shared/ProfileFieldPrimitives";
import { QUALIFYING_EXAM_LABELS } from "@/types";
import type { FacultyProfileFields, QualifiedExamEntry, QualifyingExamType } from "@/types";

// NET/SLET/SET/GATE/Others - Yes/No, then one block of Qualified Exam / Exam Score / Qualified Year per exam.
// The first exam is the original four scalar fields; "Add another exam" appends further ones to
// additionalQualifiedExams (see lib/faculty/qualifiedExams.ts). Used by both qualification editors so the two
// can never differ.

type Value = Partial<FacultyProfileFields>;

const without = <T extends object>(o: T, ...keys: (keyof T)[]): T => {
  const copy = { ...o };
  for (const k of keys) delete copy[k];
  return copy;
};

function ExamBlock({ exam, specify, score, year, onExam, onSpecify, onScore, onYear, onClearExam }: {
  exam: QualifyingExamType | undefined; specify: string | undefined; score: string | undefined; year: number | undefined;
  onExam: (v: QualifyingExamType) => void; onSpecify: (v: string) => void; onScore: (v: string) => void; onYear: (v: number | undefined) => void;
  onClearExam: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="space-y-2">
        <Label>Qualified Exam</Label>
        <Select value={exam ?? ""} onValueChange={(v) => onExam(v as QualifyingExamType)}>
          <SelectTrigger onClear={exam ? onClearExam : undefined}><SelectValue placeholder="Select exam" /></SelectTrigger>
          <SelectContent>
            {Object.entries(QUALIFYING_EXAM_LABELS).map(([k, lbl]) => <SelectItem key={k} value={k}>{lbl}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {exam === "OTHER" && <TextInput label="Please specify exam" value={specify} onChange={onSpecify} />}
      <TextInput label="Exam Score" value={score} onChange={onScore} />
      {/* NumInput reports 0 for a cleared box - that means "no year", never the year 0. */}
      <NumInput label="Qualified Year" value={year} onChange={(v) => onYear(v ? v : undefined)} />
    </div>
  );
}

export function QualifiedExamFields({ value, onChange }: { value: Value; onChange: (next: Value) => void }) {
  const extra: QualifiedExamEntry[] = value.additionalQualifiedExams ?? [];
  const setExtra = (next: QualifiedExamEntry[]) => onChange({ ...value, additionalQualifiedExams: next });
  const patchExtra = (i: number, patch: Partial<QualifiedExamEntry>) => {
    const next = [...extra];
    const merged: QualifiedExamEntry = { ...next[i], ...patch };
    // Blank values are removed, never stored as undefined/empty.
    next[i] = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined && v !== "")) as QualifiedExamEntry;
    setExtra(next);
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>NET/SLET/SET/GATE/Others</Label>
          <Select value={value.netSletSetGateOthers ?? ""} onValueChange={(v) => onChange({ ...value, netSletSetGateOthers: v as FacultyProfileFields["netSletSetGateOthers"] })}>
            <SelectTrigger onClear={value.netSletSetGateOthers ? () => onChange(without(value, "netSletSetGateOthers")) : undefined}><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="YES">Yes</SelectItem>
              <SelectItem value="NO">No</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {value.netSletSetGateOthers === "YES" && (
        <>
          {extra.length > 0 && <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Exam 1</p>}
          <ExamBlock
            exam={value.qualifiedExam} specify={value.pleaseSpecifyExam} score={value.examScore} year={value.qualifiedYear}
            onExam={(v) => onChange({ ...value, qualifiedExam: v })}
            onSpecify={(v) => onChange({ ...value, pleaseSpecifyExam: v })}
            onScore={(v) => onChange({ ...value, examScore: v })}
            onYear={(v) => onChange(v === undefined ? without(value, "qualifiedYear") : { ...value, qualifiedYear: v })}
            onClearExam={() => onChange(without(value, "qualifiedExam"))}
          />

          {extra.map((entry, i) => (
            <div key={i} className="space-y-2 rounded-md bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Exam {i + 2}</p>
                <Button type="button" variant="ghost" size="sm" aria-label={`Remove exam ${i + 2}`} onClick={() => setExtra(extra.filter((_, idx) => idx !== i))}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
              <ExamBlock
                exam={entry.exam} specify={entry.pleaseSpecifyExam} score={entry.examScore} year={entry.qualifiedYear}
                onExam={(v) => patchExtra(i, { exam: v })}
                onSpecify={(v) => patchExtra(i, { pleaseSpecifyExam: v })}
                onScore={(v) => patchExtra(i, { examScore: v })}
                onYear={(v) => patchExtra(i, { qualifiedYear: v })}
                onClearExam={() => { const next = [...extra]; next[i] = without(next[i], "exam"); setExtra(next); }}
              />
            </div>
          ))}

          <Button type="button" variant="outline" size="sm" onClick={() => setExtra([...extra, {}])}>
            Add another exam
          </Button>
        </>
      )}
    </div>
  );
}
