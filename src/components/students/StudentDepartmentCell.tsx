// The Department cell of the students lists. A student enrolled under a shared department (e.g. Basic Science) who is
// pre-registered to a core branch carries that branch as `secondaryDepartment` (its "Core Department"). Instead of a
// Core Department column that is empty for almost everyone, the branch is shown here, under the department name -
// and only for the students that have one. Display only: nothing is read or written differently.
export function StudentDepartmentCell({ department, coreDepartment }: { department?: string | null; coreDepartment?: string | null }) {
  const core = typeof coreDepartment === "string" ? coreDepartment.trim() : "";
  const dept = typeof department === "string" ? department.trim() : "";
  if (!dept && !core) return <span className="text-muted-foreground/50">—</span>;
  return (
    <div className="space-y-0.5">
      <div>{dept || <span className="text-muted-foreground/50">—</span>}</div>
      {core && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title={`Core Department: ${core}`}>
          <span className="rounded bg-primary/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-primary">Core</span>
          <span>{core}</span>
        </div>
      )}
    </div>
  );
}
