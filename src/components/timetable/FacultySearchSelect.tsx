"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { cn } from "@/lib/utils";

export interface FacultySearchOption {
  id: string;
  employeeId?: string;
  legalName?: string;
  honorific?: string;
}

// A faculty <Select> with a search box, swapped in wherever a plain Select
// listed faculty by name alone - departments with a large roster made
// scrolling a long unsearched list the only way to find someone. Matches
// against both the display name and the Employee ID, so "CS045" works as
// well as a name fragment. Keeps the same value/onValueChange shape as
// Select so call sites barely change.
export function FacultySearchSelect({
  faculty, value, onValueChange, placeholder = "Select faculty", disabled, className, showLoad,
}: {
  faculty: FacultySearchOption[];
  value: string;
  onValueChange: (facultyId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Show each person's hours/week already assigned (list rows and the selected value). */
  showLoad?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = faculty.find((f) => f.id === value);
  const idsKey = faculty.map((f) => f.id).sort().join(",");
  const { data: loads } = useQuery({
    queryKey: ["faculty-load", idsKey],
    queryFn: () => fetch(`/api/college/faculty-load?ids=${encodeURIComponent(idsKey)}`)
      .then((r) => (r.ok ? r.json() : { loads: {} })).then((d: { loads?: Record<string, { hours: number; subjects: number }> }) => d.loads ?? {}),
    enabled: !!showLoad && !!idsKey && (open || !!value),
    staleTime: 30_000,
  });
  const loadText = (id: string) => {
    const l = loads?.[id];
    return l ? `${l.hours} hrs/wk${l.subjects ? ` · ${l.subjects} subject${l.subjects > 1 ? "s" : ""}` : ""}` : "";
  };

  const q = search.trim().toLowerCase();
  const visible = q
    ? faculty.filter((f) => facultyDisplayName(f).toLowerCase().includes(q) || (f.employeeId ?? "").toLowerCase().includes(q))
    : faculty;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-64 justify-between font-normal", className)}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? `${facultyDisplayName(selected)}${selected.employeeId ? ` (${selected.employeeId})` : ""}${showLoad && loadText(selected.id) ? ` - already ${loadText(selected.id)}` : ""}` : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search by name or Employee ID…" value={search} onValueChange={setSearch} autoFocus />
          <CommandList className="max-h-64">
            <CommandEmpty>{faculty.length === 0 ? "No faculty available." : "No match."}</CommandEmpty>
            {visible.map((f) => (
              <CommandItem key={f.id} value={f.id} onSelect={() => { onValueChange(f.id); setOpen(false); setSearch(""); }}>
                <Check className={cn("mr-2 h-4 w-4 shrink-0", f.id === value ? "opacity-100" : "opacity-0")} />
                <span className="flex-1 truncate">{facultyDisplayName(f)}</span>
                {showLoad && loads && <span className="ml-3 shrink-0 text-xs font-medium text-foreground">{loadText(f.id)}</span>}
                {f.employeeId && <span className="ml-3 shrink-0 text-xs text-muted-foreground">{f.employeeId}</span>}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
