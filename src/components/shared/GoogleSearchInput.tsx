"use client";

import { useRef } from "react";
import { Search, X } from "lucide-react";

interface GoogleSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export function GoogleSearchInput({
  value,
  onChange,
  placeholder = "Search...",
  className = "",
  autoFocus = false,
}: GoogleSearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClear = () => {
    onChange("");
    inputRef.current?.focus();
  };

  return (
    <div
      className={`relative flex items-center w-full max-w-md rounded-full bg-muted/30 hover:bg-muted/50 focus-within:bg-background border border-border/60 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 shadow-xs transition-all duration-200 ${className}`}
    >
      <Search className="h-4 w-4 text-muted-foreground ml-3.5 shrink-0 pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full h-10 sm:h-11 bg-transparent px-3 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear search"
          className="h-7 w-7 mr-2 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
