"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Printer, Download } from "lucide-react";
import type { Circular } from "@/types/circular";

function fmtDate(d: unknown): string {
  try {
    const date = (d as { toDate?: () => Date })?.toDate?.() ?? new Date(d as string);
    return date.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric", month: "long", day: "numeric" });
  } catch { return ""; }
}

export function CircularViewer({ circularId }: { circularId?: string }) {
  const params = useParams<{ id: string }>();
  const id = circularId ?? params?.id;
  const [circular, setCircular] = useState<Circular | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/college/circulars/${id}`).then((r) => r.json()).then((j) => setCircular(j.circular ?? null)).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="h-64 rounded border bg-muted/30 animate-pulse" />;
  if (!circular) return <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Circular not found.</CardContent></Card>;

  const dateStr = fmtDate(circular.date as unknown as string);

  return (
    <Card className="overflow-hidden print:shadow-none">
      <CardHeader className="border-b bg-muted/30 print:bg-white">
        <CardTitle className="text-xl">{circular.subject}</CardTitle>
        <div className="text-xs text-muted-foreground">From: {circular.messageFrom} · Date: {dateStr} · ID: {circular.id} · {circular.status}</div>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <div className="whitespace-pre-wrap leading-relaxed text-sm">{circular.body}</div>

        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground border-t pt-4">
          <span>Audience: {circular.audience.employeeType}</span>
          <span>· Departments: {circular.audience.departmentNames?.join(", ") || circular.audience.departmentIds.join(", ") || "All"}</span>
        </div>

        {circular.attachments?.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Attachments</p>
            {circular.attachments.map((a, i) => (
              <a key={i} href={a.fileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-primary hover:underline">
                <FileText className="h-4 w-4" /> {a.fileName}
              </a>
            ))}
          </div>
        )}

        <div className="flex gap-2 print:hidden">
          <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button>
          {circular.attachments?.[0] && <a href={circular.attachments[0].fileUrl} download><Button variant="outline"><Download className="h-4 w-4" /> Download</Button></a>}
          <Button variant="outline" onClick={() => {
            const html = `<!doctype html><html><head><meta charset="utf-8"><title>${circular.subject}</title></head><body style="font-family:Inter,system-ui;padding:40px"><h1>${circular.subject}</h1><p>From: ${circular.messageFrom} · ${dateStr}</p><pre style="white-space:pre-wrap">${circular.body}</pre></body></html>`;
            const w = window.open("", "_blank");
            if (w) { w.document.write(html); w.document.close(); w.print(); }
          }}>Download as PDF (Print)</Button>
        </div>
      </CardContent>
    </Card>
  );
}
