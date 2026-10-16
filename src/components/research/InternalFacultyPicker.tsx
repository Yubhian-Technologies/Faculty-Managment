"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

// Internal faculty are picked, not typed: Department first (only this
// college's departments), then a searchable list of that department's
// faculty. The Employee ID is still what gets stored (`facultyId`), so the
// server keeps resolving internal people exactly as before.
//
// Former faculty (resigned / retired) are left out unless `allowFormer` is set,
// and then only when "Include former faculty" is ticked - or when the person
// already picked is one, so reopening a record never loses its author. They are
// still this college's own people: the server fills their affiliation from the
// college's record, exactly as for serving faculty.

interface FacultyOption { employeeId: string; name: string; department: string; former?: boolean }

// One fetch per page load, shared by every row of every picker.
let cache: Promise<FacultyOption[]> | null = null;
function loadFaculty(): Promise<FacultyOption[]> {
  if (!cache) {
    cache = fetch("/api/college/faculty-lookup?list=1")
      .then((r) => (r.ok ? r.json() : { faculty: [] }) as Promise<{ faculty?: FacultyOption[] }>)
      .then((d) => d.faculty ?? [])
      .catch(() => { cache = null; return []; });
  }
  return cache;
}

export function InternalFacultyPicker({
  facultyId, label, required, allowFormer, onPick,
}: {
  facultyId: string;
  label: React.ReactNode;
  required?: boolean;
  /** Offer the "Include former faculty" choice (publications, patents, projects). */
  allowFormer?: boolean;
  onPick: (p: { facultyId: string; name: string; department?: string }) => void;
}) {
  const [all, setAll] = useState<FacultyOption[] | null>(null);
  const [dept, setDept] = useState("");
  const [open, setOpen] = useState(false);
  const [showFormer, setShowFormer] = useState(false);

  useEffect(() => { void loadFaculty().then(setAll); }, []);

  const selected = all?.find((f) => f.employeeId === facultyId);
  // A former person already picked keeps the box ticked (and listed) so they can't vanish from under the form.
  const formerShown = !!allowFormer && (showFormer || !!selected?.former);
  const visible = useMemo(() => (all ?? []).filter((f) => !f.former || formerShown), [all, formerShown]);
  const activeDept = dept || selected?.department || "";
  const departments = useMemo(() => [...new Set(visible.map((f) => f.department))].sort(), [visible]);
  const people = useMemo(() => visible.filter((f) => f.department === activeDept), [visible, activeDept]);

  return (
    <div className="col-span-full space-y-2">
      {allowFormer && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer w-fit">
          <Checkbox
            checked={formerShown}
            disabled={!!selected?.former}
            onCheckedChange={(v) => setShowFormer(v === true)}
          />
          Include former faculty (resigned / retired)
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Department{required ? <span className="text-destructive"> *</span> : null}</Label>
          <Select value={activeDept} onValueChange={(v) => { setDept(v); setOpen(true); if (v !== selected?.department) onPick({ facultyId: "", name: "" }); }}>
            <SelectTrigger><SelectValue placeholder={all ? "Select department" : "Loading…"} /></SelectTrigger>
            <SelectContent>
              {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{label}</Label>
          <Button
            type="button" variant="outline" disabled={!activeDept} onClick={() => setOpen((o) => !o)}
            className="w-full justify-between font-normal"
          >
            <span className={`truncate ${selected ? "" : "text-muted-foreground"}`}>
              {selected ? `${selected.name} (${selected.employeeId})${selected.former ? " - Former" : ""}` : activeDept ? "Search faculty…" : "Select a department first"}
            </span>
            <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </div>
      </div>
      {/* Inline, in the page flow: it grows with the form instead of floating over it. */}
      {open && activeDept && (
        <Command className="h-auto rounded-md border">
          <CommandInput placeholder={`Search faculty in ${activeDept} by name or ID…`} autoFocus />
          <CommandList className="max-h-72">
            <CommandEmpty>No faculty found in {activeDept}.</CommandEmpty>
            {people.map((f) => (
              <CommandItem
                key={f.employeeId}
                value={`${f.name} ${f.employeeId}`}
                onSelect={() => { onPick({ facultyId: f.employeeId, name: f.name, department: f.department }); setOpen(false); }}
                className="py-2"
              >
                <Check className={`h-4 w-4 mr-2 shrink-0 ${f.employeeId === facultyId ? "opacity-100" : "opacity-0"}`} />
                <span className="flex-1 break-words">
                  {f.name}
                  {f.former && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Former</span>}
                </span>
                <span className="ml-3 shrink-0 text-xs text-muted-foreground">{f.employeeId}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      )}
    </div>
  );
}
