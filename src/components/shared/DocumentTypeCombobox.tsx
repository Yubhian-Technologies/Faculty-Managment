"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { DOCUMENT_TYPE_GROUPS } from "@/lib/documentTypes";
import { cn } from "@/lib/utils";

// Categorized, searchable picker for a certificate/document label. Falls back
// to whatever the user typed if it doesn't match a known document name.
export function DocumentTypeCombobox({
  value,
  onChange,
  placeholder = "Select or search a document type...",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search document type..." value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>
              {search.trim() ? (
                <button
                  type="button"
                  className="w-full text-left px-2 py-1.5 text-sm hover:bg-accent rounded-sm"
                  onClick={() => { onChange(search.trim()); setOpen(false); setSearch(""); }}
                >
                  Use &quot;{search.trim()}&quot;
                </button>
              ) : (
                "No matching document."
              )}
            </CommandEmpty>
            {DOCUMENT_TYPE_GROUPS.map((group) => {
              const items = group.items.filter((item) =>
                item.toLowerCase().includes(search.trim().toLowerCase())
              );
              if (items.length === 0) return null;
              return (
                <CommandGroup key={group.category} heading={group.category}>
                  {items.map((item) => (
                    <CommandItem
                      key={item}
                      value={item}
                      onSelect={() => { onChange(item); setOpen(false); setSearch(""); }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", value === item ? "opacity-100" : "opacity-0")} />
                      {item}
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
