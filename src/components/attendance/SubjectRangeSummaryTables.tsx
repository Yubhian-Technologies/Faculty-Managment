import { Card } from "@/components/ui/card";

export interface SubjectColumn {
  assignmentId: string;
  subjectId: string;
  subjectName: string;
}
export interface SubjectStat {
  held: number;
  attend: number;
  percent: number | null;
}
export interface SubjectRangeStudentRow {
  id: string;
  rollNumber: string;
  name: string;
  bySubject: Record<string, SubjectStat>;
}

export function PercentCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return <span className={value < 75 ? "font-semibold text-red-600" : "text-foreground"}>{value.toFixed(2)}</span>;
}

// One flat Registration No/Name x Held/Attend/% table per subject a faculty
// actually teaches a section (almost always exactly one - a second only
// appears if the same faculty also has a separate assignment there, e.g. a
// lab alongside the lecture). Shared by the Faculty Attendance Report's
// Period/Till Now modes (panel/monthly-records/[sectionId]/page.tsx) and its
// per-month "Month" tab (panel/monthly-records/[sectionId]/[year]/[month]/
// page.tsx) - same shape either way, see /api/college/class-work-records's
// summary mode.
export function SubjectRangeSummaryTables({ subjects, students }: {
  subjects: SubjectColumn[];
  students: SubjectRangeStudentRow[];
}) {
  return (
    <div className="space-y-4">
      {subjects.map((sub) => (
        <Card key={sub.assignmentId} className="overflow-hidden">
          <p className="border-b bg-muted/50 px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-foreground">
            {sub.subjectName}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Registration No.</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3 text-center">Held</th>
                  <th className="px-4 py-3 text-center">Attend</th>
                  <th className="px-4 py-3 text-center">%</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {students.map((s) => {
                  const stat = s.bySubject[sub.assignmentId];
                  return (
                    <tr key={s.id}>
                      <td className="px-4 py-2.5">{s.rollNumber}</td>
                      <td className="px-4 py-2.5 font-medium">{s.name}</td>
                      <td className="px-4 py-2.5 text-center">{stat?.held ?? 0}</td>
                      <td className="px-4 py-2.5 text-center">{stat?.attend ?? 0}</td>
                      <td className="px-4 py-2.5 text-center"><PercentCell value={stat?.percent ?? null} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}
