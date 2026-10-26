"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { Pagination } from "@/components/shared/Pagination";
import { toast } from "@/hooks/useToast";
import { compareStudentsForList } from "@/lib/students/listOrder";
import { classRepresentativeCountOf } from "@/lib/sections/classRepresentatives";
import { sectionTitle, shortCourseName } from "@/lib/sections/sectionTitle";
import { SUBJECT_TYPE_LABELS } from "@/types";
import type { Section, StudentRecord, TeachingAssignment } from "@/types";

// The whole section a faculty incharge looks after: who is in it, the subjects and who teaches each, and its
// students. Read-only; the Class Representatives are picked in Section Settings.
export default function MySectionPage() {
  const router = useRouter();
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  async function loadSection(sec: Section | undefined) {
    if (!sec) { setStudents([]); setAssignments([]); return; }
    try {
      const [studentsRes, assignRes] = await Promise.all([
        fetch(`/api/college/students?section=${encodeURIComponent(sec.name)}&year=${sec.year}`),
        fetch(`/api/college/teaching-assignments?sectionId=${sec.id}`),
      ]);
      const sd = await studentsRes.json() as { students?: StudentRecord[] };
      const ad = await assignRes.json() as { assignments?: TeachingAssignment[] };
      setStudents((sd.students ?? [])
        .filter((s) => s.department === sec.department || s.secondaryDepartment === sec.department)
        .sort(compareStudentsForList));
      setAssignments((ad.assignments ?? []).filter((a) => !a.isPast));
    } catch {
      toast({ variant: "destructive", title: "Failed to load section" });
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/sections");
        const json = await res.json() as { sections?: Section[] };
        const list = json.sections ?? [];
        setSections(list);
        setSectionId(list[0]?.id ?? "");
        await loadSection(list[0]);
      } catch {
        toast({ variant: "destructive", title: "Failed to load sections" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const section = sections.find((s) => s.id === sectionId);
  const subjectRows = useMemo(() => {
    const bySubject = new Map<string, TeachingAssignment>();
    for (const a of assignments) if (!bySubject.has(a.subjectId)) bySubject.set(a.subjectId, a);
    return Array.from(bySubject.values()).sort((a, b) => a.subjectName.localeCompare(b.subjectName));
  }, [assignments]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? students.filter((s) => s.name.toLowerCase().includes(q) || (s.rollNumber ?? "").toLowerCase().includes(q)) : students;
  }, [students, search]);
  const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)));
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  if (!isLoading && sections.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Section" description="The section you are in charge of" />
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            You are not currently in charge of any section. Ask your HOD to assign you as the faculty-in-charge for a section.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={section ? sectionTitle({ courseName: section.courseName, year: section.year, sectionName: section.name }) : "My Section"}
        description={section ? `${[shortCourseName(section.courseName), section.department].filter(Boolean).join(" · ")} · Year ${section.year}${section.batch ? ` · ${section.batch}` : ""}${section.regulation ? ` · ${section.regulation}` : ""}` : "The section you are in charge of"}
      />

      {sections.length > 1 && (
        <div className="space-y-1.5 max-w-xs">
          <Label>Section</Label>
          <Select value={sectionId} onValueChange={(id) => { setSectionId(id); setPage(1); setSearch(""); void loadSection(sections.find((s) => s.id === id)); }}>
            <SelectTrigger><SelectValue placeholder="Select a section" /></SelectTrigger>
            <SelectContent>
              {sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} (Year {s.year})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {section && (
        <>
          <dl className="space-y-1.5 text-sm">
            <div className="flex gap-2"><dt className="text-muted-foreground">Total No of students enrolled -</dt><dd className="font-medium">{students.length}</dd></div>
            <div className="flex gap-2"><dt className="text-muted-foreground">Class I/c -</dt><dd className="font-medium">{section.facultyInchargeName || "Not assigned"}</dd></div>
            {Array.from({ length: classRepresentativeCountOf(section) }, (_, i) => (
              <div key={i} className="flex gap-2">
                <dt className="text-muted-foreground">Class representative-{i + 1} -</dt>
                <dd className="font-medium">{section.classRepresentatives?.[i]?.name || <span className="font-normal text-muted-foreground">Not selected</span>}</dd>
              </div>
            ))}
          </dl>

          <Card>
            <div className="border-b px-4 py-3 font-semibold text-sm">Subjects &amp; Faculty</div>
            <CardContent className="p-0">
              {subjectRows.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">No faculty has been assigned to this section&apos;s subjects yet.</p>
              ) : (
                <div className="divide-y">
                  {subjectRows.map((a) => (
                    <div key={a.subjectId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <div>
                        <p className="font-medium">{a.subjectName}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.subjectCode}{a.subjectType ? ` · ${SUBJECT_TYPE_LABELS[a.subjectType] ?? a.subjectType}` : ""}
                        </p>
                      </div>
                      <span className="text-muted-foreground">{a.facultyName || "Unassigned"}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <span className="font-semibold text-sm">Enrolled Students</span>
              {students.length > 0 && (
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8 h-9 text-sm" placeholder="Search Regd. No, name..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
                </div>
              )}
            </div>
            <CardContent className="p-0">
              {students.length === 0 ? (
                <div className="py-16"><EmptyState title="No students in this section yet" description="Students will show up here once added." icon={<Users className="h-8 w-8" />} /></div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Regd. No.</th>
                          <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Name</th>
                          <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                          <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Gender</th>
                          <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Email</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {pageRows.map((s) => (
                          <tr key={s.id} onClick={() => router.push(`/panel/students/${s.id}`)} className="cursor-pointer hover:bg-muted/40 transition-colors">
                            <td className="px-4 py-2.5 font-mono">{s.rollNumber}</td>
                            <td className="px-4 py-2.5 font-medium">{s.name}</td>
                            <td className="px-4 py-2.5">
                              <Badge variant={s.status === "REGULAR" ? "default" : "secondary"} className="text-xs">
                                {s.status === "REGULAR" ? "Regular" : s.status === "DETAINED" ? "Detained" : "Graduated"}
                              </Badge>
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground">{s.gender || "-"}</td>
                            <td className="px-4 py-2.5 text-muted-foreground">{s.email || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="p-4 border-t">
                    <Pagination page={safePage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
