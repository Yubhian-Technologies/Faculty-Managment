"use client";

import { RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

// The Load button that goes with a filter bar (see hooks/useAppliedFilters).
// It says "Load" while the filters differ from what is shown, and "Refresh" once they match.
export function LoadButton({ dirty, onClick, loading, className, label = "Load" }: {
  dirty: boolean;
  onClick: () => void;
  loading?: boolean;
  className?: string;
  label?: string;
}) {
  return (
    <Button type="button" onClick={onClick} loading={loading} disabled={loading} variant={dirty ? "default" : "outline"} className={className}>
      {dirty ? <Search className="h-4 w-4 mr-1.5" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
      {dirty ? label : "Refresh"}
    </Button>
  );
}
