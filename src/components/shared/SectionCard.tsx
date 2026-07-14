import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

const ACCENTS = {
  blue: { border: "border-l-blue-500", badge: "bg-blue-50 text-blue-600" },
  violet: { border: "border-l-violet-500", badge: "bg-violet-50 text-violet-600" },
  emerald: { border: "border-l-emerald-500", badge: "bg-emerald-50 text-emerald-600" },
  amber: { border: "border-l-amber-500", badge: "bg-amber-50 text-amber-600" },
} as const;

interface Props {
  icon: LucideIcon;
  title: string;
  accent: keyof typeof ACCENTS;
  children: React.ReactNode;
  className?: string;
}

// Consistent "graded" elevation for detail cards across the management dashboard:
// a colored left rail + icon badge to tell sections apart at a glance, and a
// shadow that lifts further on hover so the card reads as a distinct layer.
export function SectionCard({ icon: Icon, title, accent, children, className }: Props) {
  const a = ACCENTS[accent];
  return (
    <Card className={cn("border-l-4 shadow-md hover:shadow-lg transition-shadow duration-200", a.border, className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className={cn("flex h-7 w-7 items-center justify-center rounded-md", a.badge)}>
            <Icon className="h-4 w-4" />
          </span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
