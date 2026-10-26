import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  // A short explanation of the page, shown under the title and description as part of the heading (not in a box).
  note?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, note, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-6", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        )}
        {note && (
          <p className="mt-2 max-w-3xl border-l-2 border-primary/30 pl-3 text-sm leading-relaxed text-muted-foreground" data-testid="page-note">{note}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 mt-3 sm:mt-0 sm:justify-end">{actions}</div>}
    </div>
  );
}
