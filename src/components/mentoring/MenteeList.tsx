"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import type { MenteeSummary } from "@/types/mentoring";

/** A plain, linked list of students - each row opens `${basePath}/${studentId}`. */
export function MenteeList({ students, basePath, empty }: { students: MenteeSummary[]; basePath: string; empty: string }) {
  if (students.length === 0) {
    return <p className="text-sm text-muted-foreground py-6">{empty}</p>;
  }
  return (
    <Card>
      <CardContent className="pt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted-foreground border-b">
            <th className="py-2 pr-3 font-medium">Roll No</th>
            <th className="py-2 pr-3 font-medium">Name</th>
            <th className="py-2 pr-3 font-medium">Branch</th>
            <th className="py-2 pr-3 font-medium">Year</th>
            <th className="py-2 font-medium">Section</th>
          </tr></thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="py-2 pr-3 tabular-nums">{s.rollNumber || "—"}</td>
                <td className="py-2 pr-3">
                  <Link href={`${basePath}/${s.id}`} className="font-medium text-primary hover:underline">{s.name}</Link>
                </td>
                <td className="py-2 pr-3">{s.department}</td>
                <td className="py-2 pr-3">{s.year}</td>
                <td className="py-2">{s.section || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
