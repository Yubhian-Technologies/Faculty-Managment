"use client";

import { Check } from "lucide-react";

export interface FilterChipOption<T extends string = string> {
  value: T;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

interface GoogleFilterChipsProps<T extends string = string> {
  options: FilterChipOption<T>[];
  selectedValue: T;
  onChange: (value: T) => void;
  className?: string;
  size?: "sm" | "md";
}

export function GoogleFilterChips<T extends string = string>({
  options,
  selectedValue,
  onChange,
  className = "",
  size = "md",
}: GoogleFilterChipsProps<T>) {
  const isSm = size === "sm";

  return (
    <div
      role="radiogroup"
      className={`flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 ${className}`}
    >
      {options.map((opt) => {
        const isSelected = selectedValue === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(opt.value)}
            className={`inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-all duration-150 shrink-0 ${
              isSm ? "h-7 px-3 text-[11px]" : "h-8 sm:h-9 px-3.5 text-xs"
            } ${
              isSelected
                ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                : "bg-muted/40 hover:bg-muted/70 text-muted-foreground hover:text-foreground border border-border/60"
            }`}
          >
            {opt.icon && <span className="shrink-0">{opt.icon}</span>}
            {isSelected && !opt.icon && <Check className="h-3 w-3 shrink-0 animate-in fade-in zoom-in-75 duration-100" />}
            <span>{opt.label}</span>
            {opt.count !== undefined && (
              <span
                className={`ml-0.5 rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                  isSelected
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
