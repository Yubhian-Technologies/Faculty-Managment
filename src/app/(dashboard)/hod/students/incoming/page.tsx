"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import type { StudentListItem } from "@/types";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function IncomingStudentsPage() {
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    fetch("/api/college/students")
      .then((r) => r.json() as Promise<{ students: StudentListItem[] }>)
      .then((d) => setStudents((d.students ?? []).filter((s) => s.accessLevel === "secondary")))
      .catch(() => toast({ variant: "destructive", title: "Failed to load incoming students" }))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Incoming Students"
        description="Students who've pre-registered your department while primarily enrolled elsewhere (e.g. 1st years under Basic Science) — view only until they're promoted into your department"
      />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-5 space-y-2">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
          ) : students.length === 0 ? (
            <div className="py-16">
              <EmptyState
                title="No incoming students yet"
                description="Students registered to your department by the College Office (while sitting under another department) will show up here."
                icon={<Users className="h-8 w-8" />}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Roll No.</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Name</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Currently In</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Year</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {students.map((s) => (
                    <tr key={s.id}>
                      <td className="px-4 py-2.5 font-mono">{s.rollNumber}</td>
                      <td className="px-4 py-2.5 font-medium">{s.name}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant="secondary" className="text-xs">{s.department} — Section {s.section}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{ordinalYear(s.year)}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant={s.status === "REGULAR" ? "default" : "secondary"} className="text-xs">
                          {s.status === "REGULAR" ? "Regular" : s.status === "DETAINED" ? "Detained" : "Graduated"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
