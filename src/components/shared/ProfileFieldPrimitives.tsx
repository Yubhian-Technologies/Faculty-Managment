"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { CertificateUploadField } from "@/components/shared/CertificateUploadField";
import { Plus, Trash2, ExternalLink, X } from "lucide-react";
import type { DegreeDetail } from "@/types";

// Shared building blocks for the NBA/AICTE-style profile forms (Teaching Faculty's
// AcademicProfileFields/ProfileFieldsView and Supporting Staff's SupportingStaffProfileFields/
// SupportingStaffProfileView) - extracted so both modules render identical section/field/
// repeating-list UI instead of maintaining two near-duplicate copies.

export const EMPTY_DEGREE: DegreeDetail = {
  degreeAndBranch: "", universityOrInstitute: "", percentageOrDivision: "",
  yearOfCompletion: new Date().getFullYear(), certificateUrl: "",
};

// ── Editable primitives ─────────────────────────────────────────────────────

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="pt-2 pb-1 border-t"><p className="text-sm font-medium text-muted-foreground">{children}</p></div>;
}

export function NumInput({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type="number" value={value ?? 0} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function TextInput({ label, value, onChange, placeholder }: { label: string; value: string | undefined; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function DegreeFields({ label, value, onChange }: { label: string; value: DegreeDetail | undefined; onChange: (v: DegreeDetail) => void }) {
  const v = value ?? EMPTY_DEGREE;
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextInput label="Degree & Branch" value={v.degreeAndBranch} onChange={(x) => onChange({ ...v, degreeAndBranch: x })} />
        <TextInput label="University / Institute" value={v.universityOrInstitute} onChange={(x) => onChange({ ...v, universityOrInstitute: x })} />
        <TextInput label="Percentage / Division" value={v.percentageOrDivision} onChange={(x) => onChange({ ...v, percentageOrDivision: x })} />
        <NumInput label="Year of Completion" value={v.yearOfCompletion} onChange={(x) => onChange({ ...v, yearOfCompletion: x })} />
      </div>
      <CertificateUploadField
        value={v.certificateUrl}
        onUploaded={(url) => onChange({ ...v, certificateUrl: url })}
        onRemoved={() => onChange({ ...v, certificateUrl: "" })}
      />
    </div>
  );
}

export function RepeatingGroup<T>({
  title, items, empty, onChange, renderRow, addLabel = "Add",
}: {
  title: string;
  items: T[] | undefined;
  empty: T;
  onChange: (next: T[]) => void;
  renderRow: (item: T, update: (patch: Partial<T>) => void) => React.ReactNode;
  addLabel?: string;
}) {
  const list = items ?? [];
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...list, empty])}>
          <Plus className="h-3.5 w-3.5 mr-1" />{addLabel}
        </Button>
      </div>
      {list.length === 0 && <p className="text-xs text-muted-foreground">None added yet.</p>}
      {list.map((item, i) => (
        <div key={i} className="flex items-start gap-2 rounded-md bg-muted/30 p-3">
          <div className="flex-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {renderRow(item, (patch) => {
              const next = [...list];
              next[i] = { ...next[i], ...patch };
              onChange(next);
            })}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(list.filter((_, idx) => idx !== i))}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      ))}
    </div>
  );
}

// Checkbox group for a fixed enum of options (e.g. responsibilities, professional bodies).
export function CheckboxGroup<T extends string>({
  title, options, selected, onChange,
}: {
  title: string;
  options: { value: T; label: string }[];
  selected: T[] | undefined;
  onChange: (next: T[]) => void;
}) {
  const list = selected ?? [];
  function toggle(value: T, checked: boolean) {
    onChange(checked ? [...list, value] : list.filter((v) => v !== value));
  }
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((opt) => (
          <label key={opt.value} className="flex items-center gap-1.5 text-sm">
            <Checkbox checked={list.includes(opt.value)} onCheckedChange={(c) => toggle(opt.value, !!c)} />
            {opt.label}
          </label>
        ))}
      </div>
    </div>
  );
}

// Free-form list of strings (e.g. programming languages, operating systems) - type a
// value, press Enter or click Add, remove via the chip's x.
export function StringListInput({ label, values, onChange, placeholder }: {
  label: string; values: string[] | undefined; onChange: (next: string[]) => void; placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const list = values ?? [];
  function add() {
    const v = draft.trim();
    if (v && !list.includes(v)) onChange([...list, v]);
    setDraft("");
  }
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={placeholder}
        />
        <Button type="button" variant="outline" onClick={add}>Add</Button>
      </div>
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
              {v}
              <button type="button" onClick={() => onChange(list.filter((x) => x !== v))} className="hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Read-only primitives ────────────────────────────────────────────────────

export function Section({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 pt-5 border-t first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
          {number}
        </span>
        <p className="text-sm font-semibold">{title}</p>
      </div>
      {children}
    </div>
  );
}

export function SubLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{children}</p>;
}

export function Field({ label, value }: { label: string; value: string | number | undefined | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value === undefined || value === null || value === "" ? "-" : value}</p>
    </div>
  );
}

export function DegreeView({ label, degree }: { label: string; degree: DegreeDetail | undefined }) {
  return (
    <div className="rounded-lg border bg-muted/20 shadow-sm p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
      <p className="col-span-2 sm:col-span-4 text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <Field label="Degree & Branch" value={degree?.degreeAndBranch} />
      <Field label="University / Institute" value={degree?.universityOrInstitute} />
      <Field label="Percentage / Division" value={degree?.percentageOrDivision} />
      <Field label="Year of Completion" value={degree?.yearOfCompletion} />
      {degree?.certificateUrl && (
        <div className="col-span-2 sm:col-span-4">
          <a
            href={degree.certificateUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />View Certificate
          </a>
        </div>
      )}
    </div>
  );
}

export function DocLink({ url, label = "View Document" }: { url: string | undefined; label?: string }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
    >
      <ExternalLink className="h-3.5 w-3.5" />{label}
    </a>
  );
}

export function ChipList({ values }: { values: string[] | undefined }) {
  const list = values ?? [];
  if (list.length === 0) return <p className="text-xs text-muted-foreground">None recorded.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((v) => (
        <span key={v} className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs">{v}</span>
      ))}
    </div>
  );
}
