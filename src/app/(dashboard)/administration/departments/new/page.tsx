"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";

const PRESET_DEPTS = [
  "Electrical", "Civil", "Accounts", "Purchase", "Horticulture",
  "Maintenance", "Water Works", "Security", "Scholarships", "IT", "Transport",
];

export default function NewLocationDeptPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [name, setName] = useState("");
  const [customName, setCustomName] = useState("");
  const [saving, setSaving] = useState(false);

  const finalName = name === "Others" ? customName.trim() : name;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!finalName) return;
    setSaving(true);
    try {
      const res = await fetch("/api/location/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: finalName, locationId: user?.locationId ?? "" }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Department created" });
      router.push("/administration/departments");
    } catch {
      toast({ variant: "destructive", title: "Failed to create department" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-sm space-y-5">
      <PageHeader title="Add Department" description="Add a location-level administrative department" />
      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Department</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Department Name <span className="text-destructive">*</span></Label>
              <Select value={name} onValueChange={setName}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {PRESET_DEPTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  <SelectItem value="Others">Others</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {name === "Others" && (
              <div className="space-y-2">
                <Label>Custom Name <span className="text-destructive">*</span></Label>
                <Input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Enter department name..." />
              </div>
            )}
          </CardContent>
        </Card>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!finalName}>Create</Button>
        </div>
      </form>
    </div>
  );
}
