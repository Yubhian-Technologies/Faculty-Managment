"use client";

import { useEffect, useState } from "react";
import {
  Select, SelectContent, SelectTrigger, SelectValue,
  SelectGroup, SelectLabel, SelectItem, SelectSeparator,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { DesignationCatalogItem } from "@/types";

// Faculty (FacultyMember) is teaching-only; "supporting" is the full
// Supporting Staff list (Salary Structures, Budget line items - covers
// both Technical and Non-Technical since those cover the whole payroll);
// "non-technical" is College Office/Principal's Non-Technical-only picker
// (excludes whatever HOD's Technical module owns); "both" combines
// teaching + the full supporting list.
type DesignationKind = "teaching" | "supporting" | "non-technical" | "both";

interface Props {
  kind?: DesignationKind;
}

function useDesignationCatalog(kind: DesignationKind) {
  const [teaching, setTeaching] = useState<DesignationCatalogItem[]>([]);
  const [supporting, setSupporting] = useState<DesignationCatalogItem[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/designations");
        const data = await res.json() as { items?: DesignationCatalogItem[] };
        const items = (data.items ?? []).filter((d) => d.isActive);
        setTeaching(kind !== "supporting" && kind !== "non-technical" ? items.filter((d) => d.category === "FACULTY") : []);
        setSupporting(
          kind === "teaching" ? []
            : kind === "non-technical" ? items.filter((d) => d.category === "NON_TECHNICAL")
            : items.filter((d) => d.category === "TECHNICAL" || d.category === "NON_TECHNICAL")
        );
      } catch {
        // Non-fatal - the picker just stays empty until the admin's catalog loads.
      }
    })();
  }, [kind]);
  return { teaching, supporting };
}

// Shared designation option list, sourced from each college's own admin-
// curated Designation Catalog (colleges/{id}/designations - see
// DesignationCatalogCard) instead of a hardcoded per-college-type list.
// Deliberately no "Other" free-text escape hatch here - Add/Edit forms only
// offer what the admin has actually added (see DesignationSelect below for
// the one place that still needs a fallback, for pre-existing legacy text).
export function DesignationOptions({ kind = "both" }: Props) {
  const { teaching, supporting } = useDesignationCatalog(kind);
  return (
    <>
      {teaching.length > 0 && (
        <SelectGroup>
          <SelectLabel>Teaching</SelectLabel>
          {teaching.map((d) => (
            <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
          ))}
        </SelectGroup>
      )}
      {teaching.length > 0 && supporting.length > 0 && <SelectSeparator />}
      {supporting.length > 0 && (
        <SelectGroup>
          <SelectLabel>Supporting</SelectLabel>
          {supporting.map((d) => (
            <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
          ))}
        </SelectGroup>
      )}
    </>
  );
}

// A complete designation field - label + dropdown - for the places that
// record a designation outside the Faculty/Supporting Staff add forms
// (Promotion History's From/To). Keeps the "Other" free-text fallback
// ONLY here: a promotion record written before the admin-curated catalog
// existed can hold arbitrary text that wouldn't be in anyone's current
// list, and silently dropping it would lose data - selecting "Other" keeps
// the original text visible in the input beside it, the same pattern
// DegreeFields uses for Course.
export function DesignationSelect({
  label, value, onChange, kind = "both",
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  kind?: DesignationKind;
}) {
  const { teaching, supporting } = useDesignationCatalog(kind);
  const known = [...teaching.map((d) => d.name), ...supporting.map((d) => d.name)];
  const isOther = !!value && !known.includes(value);
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={isOther ? "OTHER" : (value ?? "")} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
        <SelectContent>
          <DesignationOptions kind={kind} />
          <SelectSeparator />
          <SelectItem value="OTHER">Other</SelectItem>
        </SelectContent>
      </Select>
      {isOther && (
        <Input
          value={value === "OTHER" ? "" : value}
          onChange={(e) => onChange(e.target.value || "OTHER")}
          placeholder="Please specify"
        />
      )}
    </div>
  );
}
