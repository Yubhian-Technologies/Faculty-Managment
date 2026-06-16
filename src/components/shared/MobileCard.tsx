import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MobileCardField {
  label: string;
  value: ReactNode;
  className?: string;
}

interface MobileCardProps {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  fields?: MobileCardField[];
  actions?: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function MobileCard({
  title,
  subtitle,
  badge,
  fields = [],
  actions,
  onClick,
  className,
}: MobileCardProps) {
  return (
    <Card
      className={cn("w-full", onClick && "cursor-pointer active:scale-[0.99] transition-transform", className)}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base truncate">{title}</h3>
            {subtitle && (
              <p className="text-sm text-muted-foreground truncate mt-0.5">{subtitle}</p>
            )}
          </div>
          {badge && <div className="shrink-0">{badge}</div>}
        </div>
        {fields.length > 0 && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-3">
            {fields.map((field, i) => (
              <div key={i} className={cn("min-w-0", field.className)}>
                <p className="text-xs text-muted-foreground">{field.label}</p>
                <p className="text-sm font-medium truncate">{field.value ?? "—"}</p>
              </div>
            ))}
          </div>
        )}
        {actions && (
          <div className="flex items-center gap-2 pt-2 border-t">{actions}</div>
        )}
      </CardContent>
    </Card>
  );
}
