// Abstraction over a Card — single place to change circular presentation (SOLID: single responsibility).
"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, CalendarDays, UserCircle } from "lucide-react";
import type { Circular } from "@/types/circular";
import { audienceSummary } from "@/lib/circular/audienceSummary";

function fmtDate(d: unknown): string {
  try {
    const date = (d as { toDate?: () => Date })?.toDate?.() ?? new Date(d as string);
    return date.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric", month: "short", day: "numeric" });
  } catch { return ""; }
}

export function CircularCard({
  circular,
  onOpen,
  onPublish,
  canPublish,
}: {
  circular: Circular;
  onOpen: () => void;
  onPublish?: () => void;
  canPublish?: boolean;
}) {
  return (
    <Card className="overflow-hidden transition hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base leading-tight line-clamp-2">{circular.subject}</CardTitle>
          <Badge variant={circular.status === "PUBLISHED" ? "default" : "secondary"} className="shrink-0">{circular.status}</Badge>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><UserCircle className="h-3.5 w-3.5" />{circular.messageFrom}</span>
          <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{fmtDate(circular.date)}</span>
          <span>{audienceSummary(circular.audience)}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="line-clamp-3 text-sm text-muted-foreground whitespace-pre-wrap">{circular.body}</p>
        {circular.attachments?.[0] && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />{circular.attachments[0].fileName}
          </div>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onOpen}>View</Button>
          {circular.status === "DRAFT" && canPublish && onPublish && (
            <Button size="sm" onClick={onPublish}>Publish</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
