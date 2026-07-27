"use client";

import { use, useEffect, useRef, useState } from "react";
import { CheckCircle2, FileText, UploadCloud, X, AlertCircle } from "lucide-react";

type DocEntry = {
  label: string;
  url: string;
  uploadedAt: string;
};

type PageData = {
  candidateName: string;
  position: string;
  requiredDocuments: string[];
  submittedDocuments: Record<string, DocEntry>;
};

function safeKey(label: string) {
  return label.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export default function CandidateDocsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Record<string, DocEntry>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingDocType = useRef<string>("");

  useEffect(() => {
    fetch(`/api/public/candidate-docs/${id}`)
      .then((r) => r.json() as Promise<PageData & { error?: string }>)
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setData(d);
        setSubmitted(d.submittedDocuments ?? {});
      })
      .catch(() => setError("Failed to load. Please try again."));
  }, [id]);

  function openPicker(docType: string) {
    pendingDocType.current = docType;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const docType = pendingDocType.current;
    if (!file || !docType) return;

    setUploading(docType);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("docType", docType);

      const res = await fetch(`/api/public/candidate-docs/${id}`, { method: "POST", body: fd });
      const json = await res.json() as { url?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Upload failed");

      setSubmitted((prev) => ({
        ...prev,
        [safeKey(docType)]: { label: docType, url: json.url!, uploadedAt: new Date().toISOString() },
      }));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setUploading(null);
    }
  }

  const allDone =
    data &&
    data.requiredDocuments.length > 0 &&
    data.requiredDocuments.every((d) => submitted[safeKey(d)]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center space-y-3">
          <AlertCircle className="h-10 w-10 text-destructive mx-auto" />
          <p className="font-semibold text-lg">Link not valid</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-pulse text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-2">
            <FileText className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-bold">Document Upload</h1>
          <p className="text-muted-foreground text-sm">
            Hello <strong>{data.candidateName}</strong> — please upload the required documents for your <strong>{data.position}</strong> interview.
          </p>
        </div>

        {allDone && (
          <div className="rounded-lg bg-green-50 border border-green-200 p-4 flex items-center gap-3 text-green-800">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold text-sm">All documents submitted!</p>
              <p className="text-xs mt-0.5">The interview committee has been notified. You may close this page.</p>
            </div>
          </div>
        )}

        {/* Document list */}
        <div className="space-y-3">
          {data.requiredDocuments.map((doc) => {
            const key = safeKey(doc);
            const uploaded = submitted[key];
            const isUploading = uploading === doc;

            return (
              <div
                key={doc}
                className={`rounded-lg border bg-white p-4 flex items-center justify-between gap-3 ${
                  uploaded ? "border-green-200 bg-green-50/50" : "border-border"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {uploaded ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                  ) : (
                    <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{doc}</p>
                    {uploaded && (
                      <a
                        href={uploaded.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline"
                      >
                        View uploaded file
                      </a>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isUploading}
                  onClick={() => openPicker(doc)}
                  className={`shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
                    uploaded
                      ? "border-green-300 text-green-700 hover:bg-green-100"
                      : "border-primary text-primary hover:bg-primary/5"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {isUploading ? (
                    <span className="animate-pulse">Uploading…</span>
                  ) : uploaded ? (
                    <><X className="h-3 w-3" />Re-upload</>
                  ) : (
                    <><UploadCloud className="h-3.5 w-3.5" />Upload</>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Accepted formats: PDF, JPG, PNG · Max 10 MB per file
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
