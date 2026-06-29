"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import {
  AlertCircle,
  ChevronRight,
  Info,
  Paperclip,
  X,
} from "lucide-react";
import type {
  LeaveTypeFull,
  LeaveTypeCodeV2,
  LeaveBalanceV2,
  EmployeeLeaveProfile,
  ValidationResult,
} from "@/types/leave";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";
import { countLeaveDays, toDateString } from "@/lib/leave/dayCounter";
import { runRuleEngine, buildValidationContext } from "@/lib/leave/ruleEngine";

const LT_COLOR_MAP: Record<string, string> = {
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  green: "bg-green-50 text-green-700 border-green-200",
  purple: "bg-purple-50 text-purple-700 border-purple-200",
  red: "bg-red-50 text-red-700 border-red-200",
  pink: "bg-pink-50 text-pink-700 border-pink-200",
  teal: "bg-teal-50 text-teal-700 border-teal-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  orange: "bg-orange-50 text-orange-700 border-orange-200",
  cyan: "bg-cyan-50 text-cyan-700 border-cyan-200",
  gray: "bg-gray-50 text-gray-700 border-gray-200",
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
  lime: "bg-lime-50 text-lime-700 border-lime-200",
};

export default function LeaveApplyPage() {
  const router = useRouter();

  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeFull[]>([]);
  const [balances, setBalances] = useState<LeaveBalanceV2[]>([]);
  const [profile, setProfile] = useState<EmployeeLeaveProfile | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [selectedCode, setSelectedCode] = useState<LeaveTypeCodeV2 | "">("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDaySession, setHalfDaySession] = useState<"MORNING" | "AFTERNOON">("MORNING");
  const [reason, setReason] = useState("");
  const [leaveAddress, setLeaveAddress] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [substituteArrangement, setSubstituteArrangement] = useState("");
  const [otherEmploymentAck, setOtherEmploymentAck] = useState(false);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certUrl, setCertUrl] = useState<string | null>(null);
  const [certUploading, setCertUploading] = useState(false);

  const [validating, setValidating] = useState(false);
  const [errors, setErrors] = useState<ValidationResult[]>([]);
  const [warnings, setWarnings] = useState<ValidationResult[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoadingMeta(true);
      try {
        const [ltRes, balRes] = await Promise.all([
          fetch("/api/leave/types"),
          fetch("/api/leave/balances"),
        ]);
        if (ltRes.ok) {
          const d = await ltRes.json() as { leaveTypes: LeaveTypeFull[] };
          // Filter out vacation entitlement (not applicable via leave form)
          setLeaveTypes((d.leaveTypes ?? LEAVE_TYPE_SEED).filter((lt) => !lt.rules.isVacationEntitlement));
        } else {
          setLeaveTypes(LEAVE_TYPE_SEED.filter((lt) => !lt.rules.isVacationEntitlement));
        }
        if (balRes.ok) {
          const d = await balRes.json() as { balances: LeaveBalanceV2[]; profile: EmployeeLeaveProfile | null };
          setBalances(d.balances ?? []);
          setProfile(d.profile ?? null);
        }
      } finally {
        setLoadingMeta(false);
      }
    };
    void load();
  }, []);

  const selectedType = useMemo(
    () => leaveTypes.find((lt) => lt.code === selectedCode) ?? null,
    [leaveTypes, selectedCode]
  );

  const currentBalance = useMemo(
    () => balances.find((b) => b.leaveTypeCode === selectedCode) ?? null,
    [balances, selectedCode]
  );

  const computedDays = useMemo(() => {
    if (!fromDate || !toDate) return 0;
    if (isHalfDay) return 0.5;
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (to < from) return 0;
    return countLeaveDays(from, to, {
      excludeHolidaysAndSundays: selectedType?.rules.excludeHolidaysAndSundays ?? false,
      holidayDates: new Set(), // client-side: no holiday data; server will recompute
    });
  }, [fromDate, toDate, isHalfDay, selectedType]);

  const availableDays = useMemo(() => {
    if (!currentBalance) return null;
    return Math.max(0, currentBalance.opening + currentBalance.credited - currentBalance.used - currentBalance.pending);
  }, [currentBalance]);

  // Live validation whenever key fields change
  useEffect(() => {
    if (!selectedType || !fromDate || !toDate || !profile) {
      setErrors([]);
      setWarnings([]);
      return;
    }
    setValidating(true);
    const from = new Date(fromDate);
    const to = new Date(toDate);
    const ctx = buildValidationContext({
      fromDate: from,
      toDate: to,
      computedDays,
      leaveType: selectedType,
      profile,
      currentBalance,
      holidayDates: new Set(),
    });
    const result = runRuleEngine(ctx);
    setErrors(result.errors);
    setWarnings(result.warnings);
    setValidating(false);
  }, [selectedType, fromDate, toDate, computedDays, profile, currentBalance]);

  const certRequired =
    !!selectedType?.rules.certificateRequiredAfterDays &&
    (isHalfDay ? 0.5 : computedDays) > selectedType.rules.certificateRequiredAfterDays;

  const handleCertUpload = async (file: File) => {
    setCertFile(file);
    setCertUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/certificate", { method: "POST", body: fd });
      const json = await res.json() as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        toast({ variant: "destructive", title: json.error ?? "Upload failed" });
        setCertFile(null);
        return;
      }
      setCertUrl(json.url);
      toast({ variant: "success", title: "Certificate uploaded" });
    } catch {
      toast({ variant: "destructive", title: "Upload failed" });
      setCertFile(null);
    } finally {
      setCertUploading(false);
    }
  };

  const canSubmit =
    !!selectedCode &&
    !!fromDate &&
    !!toDate &&
    !!reason.trim() &&
    !!leaveAddress.trim() &&
    !!contactNumber.trim() &&
    errors.length === 0 &&
    !submitting &&
    !certUploading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/leave/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaveTypeCode: selectedCode,
          fromDate,
          toDate,
          ...(isHalfDay ? { isHalfDay: true, halfDaySession } : {}),
          reason,
          leaveAddress,
          contactNumber,
          ...(substituteArrangement ? { substituteArrangement } : {}),
          otherEmploymentAck,
          ...(certUrl ? { medicalCertificateUrl: certUrl } : {}),
        }),
      });
      const json = await res.json() as { id?: string; error?: string; errors?: ValidationResult[] };
      if (!res.ok) {
        if (json.errors) setErrors(json.errors);
        toast({ variant: "destructive", title: json.error ?? "Submission failed" });
        return;
      }
      toast({ variant: "success", title: "Leave application submitted", description: `${computedDays} day(s) sent for HOD review.` });
      router.push("/panel/leave");
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSubmitting(false);
    }
  };

  const today = toDateString(new Date());

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Apply for Leave"
        description="Fill in the details to submit a leave application"
      />

      {!profile && !loadingMeta && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            Your leave profile is not set up. Contact HR to initialize it before applying.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Leave Type */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Leave Type</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {leaveTypes.map((lt) => {
                const isSelected = selectedCode === lt.code;
                const colorCls = LT_COLOR_MAP[lt.color] ?? LT_COLOR_MAP["gray"];
                return (
                  <button
                    key={lt.code}
                    type="button"
                    onClick={() => {
                      setSelectedCode(lt.code);
                      setIsHalfDay(false);
                    }}
                    className={`rounded-lg border-2 p-3 text-left transition-all ${
                      isSelected
                        ? `${colorCls} border-current font-semibold`
                        : "border-muted bg-background hover:border-muted-foreground/30"
                    }`}
                  >
                    <p className="text-xs font-bold">{lt.shortLabel}</p>
                    <p className="text-xs mt-0.5 truncate">{lt.label}</p>
                  </button>
                );
              })}
            </div>

            {selectedType && (
              <div className="rounded-lg bg-muted/40 p-3 space-y-1">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">{selectedType.description}</p>
                </div>
                {availableDays !== null && (
                  <p className="text-xs font-medium text-foreground ml-6">
                    Your balance: <span className="text-primary">{availableDays} day(s) available</span>
                  </p>
                )}
                {selectedType.rules.excludeHolidaysAndSundays && (
                  <p className="text-xs text-muted-foreground ml-6">
                    Holidays and Sundays are excluded from the count.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Dates */}
        {selectedType && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Leave Period</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Half-day toggle */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isHalfDay}
                    onChange={(e) => setIsHalfDay(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-sm">Half day</span>
                </label>
                {isHalfDay && (
                  <Select
                    value={halfDaySession}
                    onValueChange={(v) => setHalfDaySession(v as "MORNING" | "AFTERNOON")}
                  >
                    <SelectTrigger className="w-36 h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MORNING">Morning</SelectItem>
                      <SelectItem value="AFTERNOON">Afternoon</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className={`grid gap-4 ${isHalfDay ? "grid-cols-1" : "grid-cols-2"}`}>
                <div className="space-y-2">
                  <Label htmlFor="fromDate">{isHalfDay ? "Date" : "From Date"} *</Label>
                  <Input
                    id="fromDate"
                    type="date"
                    value={fromDate}
                    min={!selectedType.rules.retroactiveAllowed ? today : undefined}
                    onChange={(e) => {
                      setFromDate(e.target.value);
                      if (!toDate || e.target.value > toDate) setToDate(e.target.value);
                    }}
                  />
                </div>
                {!isHalfDay && (
                  <div className="space-y-2">
                    <Label htmlFor="toDate">To Date *</Label>
                    <Input
                      id="toDate"
                      type="date"
                      value={toDate}
                      min={fromDate || today}
                      onChange={(e) => setToDate(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {/* Day count indicator */}
              {fromDate && (isHalfDay || toDate) && (
                <div className="flex items-center gap-2">
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-foreground font-medium">
                    {isHalfDay ? "0.5 day (half day)" : `${computedDays} day${computedDays !== 1 ? "s" : ""}`}
                  </span>
                  {selectedType.rules.excludeHolidaysAndSundays && !isHalfDay && (
                    <span className="text-xs text-muted-foreground">(holidays/Sundays excluded)</span>
                  )}
                  {validating && <span className="text-xs text-muted-foreground">Validating...</span>}
                </div>
              )}

              {/* Validation errors */}
              {errors.length > 0 && (
                <div className="space-y-1.5">
                  {errors.map((e, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2">
                      <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                      <p className="text-xs text-red-700">{e.message}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Warnings */}
              {warnings.length > 0 && (
                <div className="space-y-1.5">
                  {warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
                      <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700">{w.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Details */}
        {selectedType && fromDate && (isHalfDay || toDate) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reason">Reason *</Label>
                <Textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Brief reason for leave..."
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="leaveAddress">Address during leave *</Label>
                <Input
                  id="leaveAddress"
                  value={leaveAddress}
                  onChange={(e) => setLeaveAddress(e.target.value)}
                  placeholder="Where can you be reached?"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="contactNumber">Contact number during leave *</Label>
                <Input
                  id="contactNumber"
                  value={contactNumber}
                  onChange={(e) => setContactNumber(e.target.value)}
                  placeholder="Mobile / landline"
                />
              </div>

              {(selectedType.rules.requiresHandoverAfterDays !== undefined && computedDays >= selectedType.rules.requiresHandoverAfterDays) && (
                <div className="space-y-2">
                  <Label htmlFor="substitute">Substitute / handover arrangement</Label>
                  <Textarea
                    id="substitute"
                    value={substituteArrangement}
                    onChange={(e) => setSubstituteArrangement(e.target.value)}
                    placeholder="Who will handle your duties? Any specific instructions?"
                    rows={2}
                  />
                </div>
              )}

              {/* Acknowledgement — no other employment during leave */}
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={otherEmploymentAck}
                  onChange={(e) => setOtherEmploymentAck(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-gray-300"
                />
                <span className="text-xs text-muted-foreground leading-relaxed">
                  I confirm I will not take up any other employment or remunerated duty during this leave period.
                </span>
              </label>

              {/* Certificate upload */}
              {certRequired && (
                <div className="space-y-2">
                  <Label>Medical / Authority Certificate (PDF)</Label>
                  {certUrl ? (
                    <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2">
                      <Paperclip className="h-4 w-4 text-green-600 shrink-0" />
                      <span className="text-xs text-green-700 flex-1 truncate">{certFile?.name ?? "Certificate uploaded"}</span>
                      <button
                        type="button"
                        onClick={() => { setCertFile(null); setCertUrl(null); }}
                        className="text-green-600 hover:text-green-800"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <label className="flex-1 cursor-pointer rounded-md border border-dashed border-muted-foreground/40 px-3 py-2 text-center hover:border-muted-foreground/60 transition-colors">
                        <input
                          type="file"
                          accept="application/pdf"
                          className="sr-only"
                          disabled={certUploading}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleCertUpload(f);
                            e.target.value = "";
                          }}
                        />
                        <span className="text-xs text-muted-foreground">
                          {certUploading ? "Uploading…" : "Click to attach certificate PDF (max 5 MB)"}
                        </span>
                      </label>
                    </div>
                  )}
                  {!certUrl && (
                    <p className="text-xs text-amber-700">
                      A certificate is required for leave exceeding {selectedType.rules.certificateRequiredAfterDays} day(s).
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        {selectedType && (
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => router.back()} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} loading={submitting}>
              Submit Application
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
