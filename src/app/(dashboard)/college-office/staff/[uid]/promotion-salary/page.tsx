"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PromotionFields, FinancialFields } from "@/components/faculty/AcademicProfileModuleFields";
import { useCollegeType } from "@/hooks/useCollegeType";
import { toast } from "@/hooks/useToast";
import type { FacultyProfileFields } from "@/types";

type PromotionSalarySlice = Pick<
  FacultyProfileFields,
  "promotionHistory" | "presentSalary" | "grossAnnualCTC" | "incrementsAwarded" | "fundingConsultancyRevenue"
>;

export default function CollegeOfficeStaffPromotionSalaryPage() {
  const router = useRouter();
  const params = useParams<{ uid: string }>();
  const uid = params.uid;
  // College Office is college-scoped, so the session's college is this staff
  // member's - its type picks the designation catalogue.
  const { collegeType } = useCollegeType();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState<Partial<PromotionSalarySlice>>({});

  useEffect(() => {
    fetch(`/api/college/users/${uid}/promotion-salary`)
      .then((r) => r.json() as Promise<{ user?: { name?: string; academicProfile?: PromotionSalarySlice } }>)
      .then((data) => {
        if (!data.user) {
          toast({ variant: "destructive", title: "Staff profile not found" });
          router.push("/college-office/staff");
          return;
        }
        setName(data.user.name ?? "");
        setValue(data.user.academicProfile ?? {});
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff profile" }))
      .finally(() => setLoading(false));
  }, [uid, router]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/college/users/${uid}/promotion-salary`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Saved" });
      router.push("/college-office/staff");
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
            <Link href="/college-office/staff"><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
          </Button>
        }
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Card>
          <CardContent className="pt-6 space-y-6">
            <PromotionFields value={value} collegeType={collegeType} onChange={(next) => setValue((v) => ({ ...v, ...next }))} />
            <FinancialFields value={value} onChange={(next) => setValue((v) => ({ ...v, ...next }))} />
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => router.push("/college-office/staff")}>Cancel</Button>
              <Button onClick={handleSave} loading={saving}>Save Changes</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
