"use client";

import { use, useEffect, useState } from "react";
import { BadgeCheck, ShieldAlert, ShieldX } from "lucide-react";

// Public: the page a certificate's QR code opens. It says whether the certificate is genuine and shows only what
// is printed on it (number, certificate, student, Regd. No, college, date) - or that it was revoked / not found.

interface Result { valid: boolean; certificate?: { certificateNumber: string; typeName: string; studentName: string; studentRollNumber: string; collegeName: string; issuedAt: string; revokedAt: string | null } }

export default function VerifyCertificatePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    fetch(`/api/public/certificate-verify/${encodeURIComponent(code)}`, { cache: "no-store" })
      .then((r) => r.json()).then((d: Result) => setResult(d)).catch(() => setResult({ valid: false }));
  }, [code]);

  const c = result?.certificate;
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
  return (
    <main className="min-h-screen bg-muted/30 px-4 py-10">
      <div className="mx-auto max-w-lg rounded-xl border bg-background p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Certificate verification</h1>
        {!result && <p className="mt-4 text-sm text-muted-foreground">Checking…</p>}
        {result && !c && (
          <div className="mt-4 flex items-start gap-3 text-red-700 dark:text-red-400">
            <ShieldX className="h-6 w-6 shrink-0" />
            <p className="text-sm">No certificate was issued with this code. It may have been mistyped, or the certificate is not genuine.</p>
          </div>
        )}
        {c && (
          <>
            <div className={`mt-4 flex items-center gap-2 font-medium ${result.valid ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
              {result.valid ? <BadgeCheck className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
              {result.valid ? "Genuine certificate" : `Revoked on ${day(c.revokedAt!)} - no longer valid`}
            </div>
            <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Certificate</dt><dd>{c.typeName}</dd>
              <dt className="text-muted-foreground">Number</dt><dd className="font-mono">{c.certificateNumber}</dd>
              <dt className="text-muted-foreground">Student</dt><dd>{c.studentName}</dd>
              <dt className="text-muted-foreground">Regd. No</dt><dd>{c.studentRollNumber}</dd>
              <dt className="text-muted-foreground">College</dt><dd>{c.collegeName}</dd>
              <dt className="text-muted-foreground">Issued on</dt><dd>{day(c.issuedAt)}</dd>
            </dl>
          </>
        )}
      </div>
    </main>
  );
}
