"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PromotionFields, FinancialFields } from "@/components/faculty/AcademicProfileModuleFields";
import { toast } from "@/hooks/useToast";
import type { FacultyProfileFields } from "@/types";

type PromotionSalarySlice = Pick<
  FacultyProfileFields,
  "promotionHistory" | "presentSalary" | "grossAnnualCTC" | "incrementsAwarded" | "fundingConsultancyRevenue"
>;

export default function CollegeOfficeFacultyPromotionSalaryPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const facultyId = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState<Partial<PromotionSalarySlice>>({});

  useEffect(() => {
    fetch(`/api/college/faculty/${facultyId}`)
      .then((r) => r.json() as Promise<{ faculty?: { name?: string; academicProfile?: PromotionSalarySlice } }>)
      .then((data) => {
        if (!data.faculty) {
          toast({ variant: "destructive", title: "Faculty record not found" });
          router.push("/college-office/faculty");
          return;
        }
        setName(data.faculty.name ?? "");
        setValue(data.faculty.academicProfile ?? {});
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load faculty record" }))
      .finally(() => setLoading(false));
  }, [facultyId, router]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/college/faculty/${facultyId}/promotion-salary`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Saved" });
      router.push("/college-office/faculty");
    } catch {
      toast({ variant: "destructive", title: "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Promotion & Salary"
        description={name}
        actions={
          <Button variant="outline" asChild>
            <Link href="/college-office/faculty"><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
          </Button>
        }
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Card>
          <CardContent className="pt-6 space-y-6">
            <PromotionFields value={value} onChange={(next) => setValue((v) => ({ ...v, ...next }))} />
            <FinancialFields value={value} onChange={(next) => setValue((v) => ({ ...v, ...next }))} />
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => router.push("/college-office/faculty")}>Cancel</Button>
              <Button onClick={handleSave} loading={saving}>Save Changes</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
