"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

// Internal faculty are picked, not typed: Department first (only this
// college's departments), then a searchable list of that department's
// faculty. The Employee ID is still what gets stored (`facultyId`), so the
// server keeps resolving internal people exactly as before.

interface FacultyOption { employeeId: string; name: string; department: string }

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
  facultyId, label, required, onPick,
}: {
  facultyId: string;
  label: React.ReactNode;
  required?: boolean;
  onPick: (p: { facultyId: string; name: string }) => void;
}) {
  const [all, setAll] = useState<FacultyOption[] | null>(null);
  const [dept, setDept] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => { void loadFaculty().then(setAll); }, []);

  const selected = all?.find((f) => f.employeeId === facultyId);
  const activeDept = dept || selected?.department || "";
  const departments = useMemo(() => [...new Set((all ?? []).map((f) => f.department))].sort(), [all]);
  const people = useMemo(() => (all ?? []).filter((f) => f.department === activeDept), [all, activeDept]);

  return (
    <div className="col-span-full space-y-2">
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
              {selected ? `${selected.name} (${selected.employeeId})` : activeDept ? "Search faculty…" : "Select a department first"}
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
                onSelect={() => { onPick({ facultyId: f.employeeId, name: f.name }); setOpen(false); }}
                className="py-2"
              >
                <Check className={`h-4 w-4 mr-2 shrink-0 ${f.employeeId === facultyId ? "opacity-100" : "opacity-0"}`} />
                <span className="flex-1 break-words">{f.name}</span>
                <span className="ml-3 shrink-0 text-xs text-muted-foreground">{f.employeeId}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      )}
    </div>
  );
}
