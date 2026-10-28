"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { TableSkeleton } from "@/components/shared/SkeletonLoader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { currentAcademicStartYear, academicSessionLabel, recentAcademicSessions } from "@/lib/college/academicSession";
import { HOLIDAY_TYPE_LABELS, HOLIDAY_CATEGORY_LABELS, SEM_BREAK_LABELS } from "@/types";
import type { Holiday, SemBreak, SummerHoliday } from "@/types";

// The college's holiday list, read-only. Academics maintains it (academics/holidays); a student sees every
// holiday (including students-only ones and classwork suspensions), the sem breaks and the summer vacation.
export default function StudentHolidaysPage() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [semBreaks, setSemBreaks] = useState<SemBreak[]>([]);
  const [summer, setSummer] = useState<SummerHoliday[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [year, setYear] = useState(() => academicSessionLabel(currentAcademicStartYear()));

  useEffect(() => {
    Promise.all([
      fetch("/api/college/holidays").then((r) => (r.ok ? r.json() : { holidays: [] })),
      fetch("/api/college/sem-breaks").then((r) => (r.ok ? r.json() : { semBreaks: [] })),
      fetch("/api/college/summer-holidays").then((r) => (r.ok ? r.json() : { summerHolidays: [] })),
    ])
      .then(([h, s, v]) => {
        setHolidays((h as { holidays?: Holiday[] }).holidays ?? []);
        setSemBreaks((s as { semBreaks?: SemBreak[] }).semBreaks ?? []);
        setSummer((v as { summerHolidays?: SummerHoliday[] }).summerHolidays ?? []);
      })
      .catch(() => toast({ title: "Could not load holidays", variant: "destructive" }))
      .finally(() => setIsLoading(false));
  }, []);

  const years = useMemo(
    () => Array.from(new Set([...recentAcademicSessions(), ...holidays.map((h) => h.academicYear)])),
    [holidays]
  );
  const shown = useMemo(() => holidays.filter((h) => h.academicYear === year), [holidays, year]);
  const shownBreaks = useMemo(() => semBreaks.filter((b) => b.academicYear === year), [semBreaks, year]);
  const shownSummer = useMemo(() => summer.filter((s) => s.academicYear === year), [summer, year]);

  return (
    <div className="space-y-6">
      <PageHeader title="Holidays" description="The college's holiday list for the academic year" />

      <div className="w-48">
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><CalendarDays className="h-4 w-4" />Holidays</CardTitle></CardHeader>
            <CardContent className="p-0">
              {shown.length === 0 ? (
                <div className="p-6"><EmptyState title="No holidays listed" description="Nothing has been added for this academic year yet." /></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Occasion</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Hostellers</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {shown.map((h) => (
                        <tr key={h.id}>
                          <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(h.date)}</td>
                          <td className="px-4 py-2.5 font-medium text-foreground">{h.name}</td>
                          <td className="px-4 py-2.5">
                            <Badge variant="secondary" className="text-xs">
                              {h.category && h.category !== "REGULAR" ? HOLIDAY_CATEGORY_LABELS[h.category] : HOLIDAY_TYPE_LABELS[h.type]}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            {h.hostelersOutingAllowed == null ? "-" : h.hostelersOutingAllowed ? "Outing permitted" : "No outing"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {(shownBreaks.length > 0 || shownSummer.length > 0) && (
            <Card>
              <CardHeader><CardTitle className="text-base">Breaks</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {shownBreaks.map((b) => (
                  <p key={b.id}>
                    <span className="font-medium">{SEM_BREAK_LABELS[b.kind]}</span>: {formatDate(b.fromDate)} to {formatDate(b.toDate)}
                    {b.hostelersOutingAllowed != null && (
                      <span className="text-xs text-muted-foreground"> - {b.hostelersOutingAllowed ? "outing permitted" : "no outing"}</span>
                    )}
                  </p>
                ))}
                {shownSummer.map((s) => (
                  <p key={s.id}><span className="font-medium">Summer Vacation</span>: {formatDate(s.fromDate)} to {formatDate(s.toDate)}</p>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
