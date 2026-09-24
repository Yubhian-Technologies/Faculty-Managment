"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, Layers } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";

interface BrowseDepartment {
  id: string;
  name: string;
  code: string;
  hodName: string;
  isActive: boolean;
}

export default function CollegeDepartmentsBrowsePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const collegeId = params.id;
  const [collegeName, setCollegeName] = useState("");
  const [departments, setDepartments] = useState<BrowseDepartment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/location/college-browse/departments?collegeId=${collegeId}`)
      .then((r) => r.json() as Promise<{ collegeName?: string; departments?: BrowseDepartment[]; error?: string }>)
      .then((d) => {
        if (d.error) {
          toast({ variant: "destructive", title: d.error });
          router.push("/administration/colleges");
          return;
        }
        setCollegeName(d.collegeName ?? "");
        setDepartments(d.departments ?? []);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load departments" }))
      .finally(() => setIsLoading(false));
  }, [collegeId, router]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/administration/colleges"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <PageHeader title={collegeName || "Departments"} description="Pick a department to search its faculty or students" />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
        </div>
      ) : departments.length === 0 ? (
        <EmptyState title="No departments in this college" icon={<Layers className="h-8 w-8" />} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((d) => (
            <Card
              key={d.id}
              className="cursor-pointer hover:border-primary hover:shadow-md transition-all"
              onClick={() => router.push(`/administration/colleges/${collegeId}/departments/${d.id}?name=${encodeURIComponent(d.name)}`)}
            >
              <CardContent className="p-5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="secondary" className="text-xs font-mono">{d.code}</Badge>
                    {!d.isActive && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                  </div>
                  <p className="font-medium truncate">{d.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {d.hodName ? `HOD: ${d.hodName}` : "No HOD assigned"}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
