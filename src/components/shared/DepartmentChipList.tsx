import { Badge } from "@/components/ui/badge";

interface DepartmentChipListProps {
  names: string[];
  className?: string;
}

// Renders a wrapped row of small chips for a list of department names -
// shared by every place that shows a department's cross-listed/managed
// branches (Core Departments on a Sub-Department card, "Cross-listed with"
// on a course card) so a long list (a shared first-year department can
// realistically cross-list to 8-9 branches) reads as scannable tags instead
// of a single run-on comma-separated sentence. Purely presentational - takes
// plain names, not Department docs, so it never touches how those lists are
// resolved or stored.
export function DepartmentChipList({ names, className }: DepartmentChipListProps) {
  if (names.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1 ${className ?? ""}`}>
      {names.map((n) => (
        <Badge key={n} variant="outline" className="text-[11px] font-normal">{n}</Badge>
      ))}
    </div>
  );
}
