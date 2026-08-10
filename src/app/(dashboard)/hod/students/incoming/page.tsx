"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { useAuthStore } from "@/store/authStore";
import type { StudentListItem } from "@/types";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function IncomingStudentsPage() {
  const user = useAuthStore((s) => s.user);
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // isLoading already starts true, so nothing is set synchronously here -
    // a setState in the effect body triggers a cascading render.
    void (async () => {
      try {
        const d = await fetch("/api/college/students")
          .then((r) => r.json() as Promise<{ students: StudentListItem[] }>);
        // secondaryDepartment (not the broader accessLevel === "secondary" tag,
        // which also covers sub-department students) is what actually marks a
        // student pre-registered here while primarily enrolled elsewhere - see
        // useIncomingStudents for the full explanation.
        setStudents((d.students ?? []).filter((s) => s.secondaryDepartment === user?.department));
      } catch {
        toast({ variant: "destructive", title: "Failed to load first year students" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [user?.department]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="First Year Students"
        description="Students who've pre-registered your department while primarily enrolled elsewhere (e.g. 1st years under Basic Science) - view only until they're promoted into your department"
      />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-5 space-y-2">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
          ) : students.length === 0 ? (
            <div className="py-16">
              <EmptyState
                title="No first year students yet"
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
                        <Badge variant="secondary" className="text-xs">{s.department} - Section {s.section}</Badge>
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
