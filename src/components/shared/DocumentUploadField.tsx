"use client";

import { useRef, useState } from "react";
import { Upload, FileText, Loader2, X, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

const MAX_SIZE_MB = 10;

interface DocumentUploadFieldProps {
  label: string;
  value?: string;
  uploadEndpoint: string;
  extraFields?: Record<string, string>;
  onUploaded: (url: string) => void;
  onRemoved: () => void;
  className?: string;
}

export function DocumentUploadField({
  label,
  value,
  uploadEndpoint,
  extraFields,
  onUploaded,
  onRemoved,
  className,
}: DocumentUploadFieldProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast({ variant: "destructive", title: `File must be under ${MAX_SIZE_MB} MB` });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (extraFields) {
        for (const [k, v] of Object.entries(extraFields)) fd.append(k, v);
      }
      const res = await fetch(uploadEndpoint, { method: "POST", body: fd });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed");
      onUploaded(data.url);
      toast({ variant: "success", title: `${label} uploaded` });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setUploading(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>

      {value ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-xs text-muted-foreground truncate">{label} uploaded</span>
          <div className="flex items-center gap-1 shrink-0">
            <a
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Eye className="h-3.5 w-3.5" />View
            </a>
            <span className="text-muted-foreground/40">|</span>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="text-xs text-primary hover:underline disabled:opacity-60"
            >
              Change
            </button>
            <span className="text-muted-foreground/40">|</span>
            <button
              type="button"
              onClick={onRemoved}
              disabled={uploading}
              className="text-xs text-destructive hover:underline disabled:opacity-60"
            >
              <X className="h-3 w-3 inline" />
            </button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full text-xs h-9 border-dashed"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Uploading…</>
          ) : (
            <><Upload className="h-3.5 w-3.5 mr-1.5" />Upload {label} (PDF / Image, max {MAX_SIZE_MB} MB)</>
          )}
        </Button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        onChange={handleChange}
        className="sr-only"
        disabled={uploading}
      />
    </div>
  );
}
