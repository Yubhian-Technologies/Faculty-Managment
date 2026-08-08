"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

// A true segmented control (2-4 fixed options, single track) - distinct from
// the app's other "filter chip" pattern (many/dynamic options, e.g. status or
// college filters) which stays as separate wrapping pill buttons since a
// single sliding track doesn't hold up once options wrap across lines.
export interface SegmentedTabsOption {
  key: string;
  label: string;
  href?: string; // renders this option as a Link instead of a button
}

interface SegmentedTabsProps {
  options: SegmentedTabsOption[];
  value: string;
  onChange?: (key: string) => void;
  className?: string;
}

export function SegmentedTabs({ options, value, onChange, className }: SegmentedTabsProps) {
  return (
    <div className={cn("inline-flex items-center gap-1 rounded-full bg-muted p-1", className)}>
      {options.map((option) => {
        const isActive = option.key === value;
        const itemClassName = cn(
          "px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap",
          isActive ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
        );
        return option.href ? (
          <Link key={option.key} href={option.href} className={itemClassName}>
            {option.label}
          </Link>
        ) : (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange?.(option.key)}
            className={itemClassName}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
