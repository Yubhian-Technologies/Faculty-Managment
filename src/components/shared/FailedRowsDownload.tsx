"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { failedRowsCsv } from "@/lib/import/chunkedImport";

// "Download failed rows" for an import result: a CSV of row number, identifier and reason, so a big
// import's problems can be fixed in a spreadsheet and the file re-imported.
export function FailedRowsDownload({ failed, filename = "failed-rows" }: {
  failed: { row: number; error?: string; identifier?: string; employeeId?: string; name?: string }[];
  filename?: string;
}) {
  if (failed.length === 0) return null;
  const download = () => {
    const blob = new Blob(["﻿" + failedRowsCsv(failed)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={download}>
      <Download className="h-3.5 w-3.5 mr-1.5" />
      Download failed rows
    </Button>
  );
}
