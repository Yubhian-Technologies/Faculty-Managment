"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileUpload } from "@/components/shared/FileUpload";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { stripLeadingZeros } from "@/lib/utils";
import type { FinanceReceiptRelatedType } from "@/types";

const RELATED_TYPES: FinanceReceiptRelatedType[] = ["BUDGET", "EXPENSE", "PAYMENT", "ALLOCATION", "INDENT"];

export default function NewReceiptPage() {
  const router = useRouter();
  const [relatedType, setRelatedType] = useState<FinanceReceiptRelatedType>("EXPENSE");
  const [relatedId, setRelatedId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!relatedId || !amount || !description) {
      toast({ variant: "destructive", title: "Fill in all required fields" });
      return;
    }
    setSaving(true);
    try {
      let fileUrl: string | undefined;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        const uploadRes = await collegeFetch("/api/upload/finance-receipt", { method: "POST", body: fd });
        const uploadData = (await uploadRes.json()) as { url?: string; error?: string };
        if (!uploadRes.ok) throw new Error(uploadData.error ?? "Upload failed");
        fileUrl = uploadData.url;
      }
      const res = await collegeFetch("/api/college/finance-receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relatedType, relatedId, amount: Number(amount), description, fileUrl }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Receipt recorded" });
      router.push("/finance/receipts");
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to record receipt", description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="New Receipt"
        description="Record a receipt for a budget, expense, payment, or allocation"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Receipt Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Related To *</Label>
              <Select value={relatedType} onValueChange={(v) => setRelatedType(v as FinanceReceiptRelatedType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RELATED_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Related Record ID *</Label>
              <Input value={relatedId} onChange={(e) => setRelatedId(e.target.value)} placeholder="Budget / expense / payment / allocation ID" />
            </div>

            <div className="space-y-2">
              <Label>Amount *</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(stripLeadingZeros(e.target.value))} />
            </div>

            <div className="space-y-2">
              <Label>Description *</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>

            <div className="space-y-2">
              <Label>Receipt File (optional)</Label>
              <FileUpload onFileSelect={setFile} accept=".pdf,.jpg,.jpeg,.png" />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving}>Record Receipt</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
