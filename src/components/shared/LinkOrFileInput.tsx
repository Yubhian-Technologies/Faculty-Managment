"use client";

import { useRef, useState } from "react";
import { Upload, Loader2, ExternalLink, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/useToast";

const MAX_SIZE_MB = 10;

// A compact table-cell field that holds one URL, which the user either pastes
// as a link or gets by uploading a PDF (the upload just returns a URL, so the
// stored value is the same shape either way).
export function LinkOrFileInput({
  value, onChange, uploadEndpoint, extraFields, placeholder = "Paste link or upload PDF", label = "File",
}: {
  value: string | undefined;
  onChange: (url: string) => void;
  uploadEndpoint: string;
  extraFields?: Record<string, string>;
  placeholder?: string;
  label?: string;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const url = value ?? "";
  const isOpenable = /^https?:\/\//i.test(url);

  async function handleFile(file: File) {
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast({ variant: "destructive", title: `File must be under ${MAX_SIZE_MB} MB` });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      for (const [k, v] of Object.entries(extraFields ?? {})) fd.append(k, v);
      const res = await fetch(uploadEndpoint, { method: "POST", body: fd });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed");
      onChange(data.url);
      toast({ variant: "success", title: `${label} uploaded` });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        className="h-8 text-sm min-w-[160px]"
        value={url}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode="url"
      />
      <button
        type="button"
        title="Upload PDF"
        aria-label={`Upload ${label} PDF`}
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="shrink-0 rounded-md border p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-60"
      >
        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
      </button>
      {isOpenable && (
        <a href={url} target="_blank" rel="noopener noreferrer" title="Open" aria-label={`Open ${label}`} className="shrink-0 rounded-md border p-1.5 text-primary hover:bg-muted">
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
      {url && (
        <button type="button" title="Clear" aria-label={`Clear ${label}`} onClick={() => onChange("")} className="shrink-0 p-1 text-destructive">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="sr-only"
        disabled={uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
