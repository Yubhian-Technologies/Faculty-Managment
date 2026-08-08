"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FacultyProfileHub } from "@/components/faculty/FacultyProfileHub";
import { toast } from "@/hooks/useToast";
import type { FacultyMember } from "@/types";

export default function HodFacultyViewPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const facultyId = params.id;

  const [faculty, setFaculty] = useState<FacultyMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/college/faculty/${facultyId}`)
      .then((r) => r.json() as Promise<{ faculty?: FacultyMember; error?: string }>)
      .then((d) => {
        if (!d.faculty) {
          toast({ variant: "destructive", title: "Faculty record not found" });
          router.push("/hod/faculty");
          return;
        }
        setFaculty(d.faculty);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load faculty record" }))
      .finally(() => setIsLoading(false));
  }, [facultyId, router]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!faculty) return null;

  return (
    <FacultyProfileHub
      faculty={faculty}
      basePath={`/hod/faculty/${facultyId}`}
      backHref="/hod/faculty"
      editHref={`/hod/faculty/${facultyId}/edit`}
    />
  );
}
