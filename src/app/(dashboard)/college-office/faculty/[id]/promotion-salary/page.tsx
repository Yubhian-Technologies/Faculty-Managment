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
import { normalizeAcademicProfile } from "@/lib/faculty/academicProfileCompat";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import {
  validatePromotionHistory, sortPromotionHistory, samePromotionHistory, runningDesignation, toDateOnly,
} from "@/lib/faculty/promotionHistory";
import { designationLabel, designationKey } from "@/lib/designations/config";
import { toast } from "@/hooks/useToast";
import type { FacultyProfileFields, PromotionRecord } from "@/types";

type PromotionSalarySlice = Pick<
  FacultyProfileFields,
  "promotionHistory" | "monthlySalary" | "grossAnnualCTC" | "incrementsAwarded" | "fundingConsultancyRevenueGeneration"
>;

export default function CollegeOfficeFacultyPromotionSalaryPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const facultyId = params.id;
  // College Office is college-scoped, so the session's college is the one this
  // faculty member belongs to - its type picks the designation catalogue.
  const { collegeType } = useCollegeType();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState<Partial<PromotionSalarySlice>>({});
  // What the Promotion History rules are checked against (see lib/faculty/promotionHistory.ts).
  const [joiningDate, setJoiningDate] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [currentDesignation, setCurrentDesignation] = useState<string | undefined>();
  const [initialHistory, setInitialHistory] = useState<PromotionRecord[]>([]);

  useEffect(() => {
    fetch(`/api/college/faculty/${facultyId}`)
      .then((r) => r.json() as Promise<{ faculty?: { name?: string; legalName?: string; joiningDate?: unknown; status?: string; designation?: string; academicProfile?: PromotionSalarySlice } }>)
      .then((data) => {
        if (!data.faculty) {
          toast({ variant: "destructive", title: "Faculty record not found" });
          router.push("/college-office/faculty");
          return;
        }
        setName(facultyDisplayName(data.faculty));
        // Un-migrated docs still carry legacy key names - lift them so the form
        // (and the PATCH body) only ever holds the current ones.
        const profile = normalizeAcademicProfile(data.faculty.academicProfile ?? {}) as Partial<FacultyProfileFields>;
        // Shown chronologically (the server stores it that way too).
        const history = sortPromotionHistory(profile.promotionHistory ?? []);
        setValue({ ...profile, promotionHistory: history });
        setInitialHistory(history);
        setJoiningDate(toDateOnly(data.faculty.joiningDate));
        setStatus(data.faculty.status);
        setCurrentDesignation(data.faculty.designation);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load faculty record" }))
      .finally(() => setLoading(false));
  }, [facultyId, router]);

  const history = value.promotionHistory ?? [];
  const rules = { joiningDate, status };
  const issues = validatePromotionHistory(history, rules);
  // Only a CHANGED history has to satisfy the rules - salary can still be saved for a faculty
  // member whose stored history predates them (it is shown with its problems, never rewritten).
  const historyChanged = !samePromotionHistory(history, initialHistory);
  const blocked = historyChanged && issues.length > 0;
  const nextDesignation = historyChanged && issues.length === 0 ? runningDesignation(history) : undefined;
  const designationWillChange = !!nextDesignation && designationKey(nextDesignation) !== designationKey(currentDesignation);

  async function handleSave() {
    if (blocked) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/college/faculty/${facultyId}/promotion-salary`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        toast({ variant: "destructive", title: "Failed to save", description: err.error });
        return;
      }
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
            <PromotionFields value={value} collegeType={collegeType} rules={rules} onChange={(next) => setValue((v) => ({ ...v, ...next }))} />
            {designationWillChange && (
              <p className="rounded-md border bg-muted/30 p-3 text-sm">
                Saving will set this faculty member&apos;s current designation to <strong>{designationLabel(nextDesignation)}</strong>
                {currentDesignation ? <> (now {designationLabel(currentDesignation)})</> : null}.
              </p>
            )}
            {blocked && (
              <p className="text-sm font-medium text-destructive">
                Fix the highlighted Promotion History rows before saving.
              </p>
            )}
            <FinancialFields value={value} onChange={(next) => setValue((v) => ({ ...v, ...next }))} />
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => router.push("/college-office/faculty")}>Cancel</Button>
              <Button onClick={handleSave} loading={saving} disabled={blocked}>Save Changes</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
