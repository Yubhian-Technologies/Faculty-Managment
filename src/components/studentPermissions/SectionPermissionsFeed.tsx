"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Clock, MapPin, Users, ShieldCheck, FileCheck } from "lucide-react";
import { formatPeriods, formatRange } from "./statusBadge";
import type { PermissionRequestView } from "./api";

interface SectionApprovedResponse {
  requests: PermissionRequestView[];
  sectionInfo: { department: string; section: string; year: number };
}

async function fetchSectionApproved(): Promise<SectionApprovedResponse> {
  const res = await fetch("/api/college/student-permissions/section-approved");
  if (!res.ok) throw new Error("Failed to load section permissions");
  return res.json();
}

export function SectionPermissionsFeed() {
  const { data, isLoading, error } = useQuery<SectionApprovedResponse>({
    queryKey: ["student-permissions", "section-approved"],
    queryFn: fetchSectionApproved,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <Card className="border shadow-xs">
        <CardContent className="p-6 text-center text-sm text-slate-500">
          Loading Class Representative section permissions...
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="border border-red-200 bg-red-50/50 shadow-xs">
        <CardContent className="p-6 text-center text-sm text-red-600">
          Unable to load section permissions. Please refresh or check your section assignment.
        </CardContent>
      </Card>
    );
  }

  const { requests, sectionInfo } = data;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-muted/40 border p-3 sm:p-4 rounded-lg">
        <div>
          <h3 className="font-semibold text-foreground flex items-center gap-2 text-sm sm:text-base">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            Class Representative Feed: Section Approved Permissions
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {sectionInfo.department} · Year {sectionInfo.year} · Section {sectionInfo.section}
          </p>
        </div>
        <Badge variant="outline" className="w-fit bg-emerald-50 text-emerald-700 border-emerald-200 rounded-md">
          {requests.length} Approved Request{requests.length === 1 ? "" : "s"}
        </Badge>
      </div>

      {requests.length === 0 ? (
        <Card className="border shadow-xs text-center p-6 sm:p-8 text-muted-foreground">
          <FileCheck className="w-10 h-10 mx-auto mb-2 text-muted" />
          <p className="text-sm font-medium">No approved permissions for this section yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Approved On-Duty permissions automatically display here.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {requests.map((req) => (
            <Card key={req.id} className="border shadow-xs hover:border-emerald-300 transition-colors">
              <CardHeader className="p-3 sm:p-4 pb-2 flex flex-row items-start justify-between space-y-0">
                <div>
                  <Badge variant="secondary" className="mb-1 text-[11px] font-medium rounded-md">
                    {req.payload.otherCategory || req.payload.categoryLabel}
                  </Badge>
                  <CardTitle className="text-sm font-semibold text-foreground line-clamp-1">
                    {req.payload.title}
                  </CardTitle>
                </div>
                <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 text-[11px] rounded-md">
                  Attendance Locked
                </Badge>
              </CardHeader>
              <CardContent className="p-3 sm:p-4 pt-1 text-xs text-muted-foreground space-y-2">
                <p className="line-clamp-2 text-foreground leading-relaxed">{req.payload.description}</p>
                
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-muted-foreground border-t border-border">
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>{formatRange(req.payload.fromDate, req.payload.toDate)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>{formatPeriods(req.payload.periods)}</span>
                  </div>
                  {req.payload.venue && (
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="truncate max-w-[140px]">{req.payload.venue}</span>
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-border">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                    <span className="flex items-center gap-1 font-medium text-foreground">
                      <Users className="w-3.5 h-3.5 text-emerald-600" />
                      Covered Students ({req.payload.students.length})
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto pr-1">
                    {req.payload.students.map((st) => (
                      <span key={st.id} className="inline-flex items-center gap-1 bg-muted px-2 py-0.5 rounded-md text-[10px] font-mono text-foreground">
                        <span className="font-semibold">{st.rollNumber}</span> ({st.name} - Sec {st.section})
                      </span>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
