"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";

interface Props {
  basePath: string;       // e.g. "/super-admin/profile"
  fetchEndpoint: string;  // "/api/admin/users/me" | "/api/location/users/me"
  patchEndpoint: string;  // "/api/admin/users/me" | "/api/location/users/me"
}

// Edit step for MyAccountProfileView - reached only via that view's explicit
// "Edit Details" button, never directly.
export function MyAccountProfileEditPage({ basePath, fetchEndpoint, patchEndpoint }: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const setUser = useAuthStore((s) => s.setUser);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (!user) return;
    fetch(fetchEndpoint)
      .then((r) => r.json() as Promise<{ user?: { name?: string; email?: string; phone?: string } }>)
      .then((d) => {
        setName(d.user?.name ?? user.name ?? "");
        setEmail(d.user?.email ?? user.email ?? "");
        setPhone(d.user?.phone ?? "");
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load profile" }))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchEndpoint, user?.uid]);

  const isValid = !!name.trim() && !!email.trim();

  async function handleSave() {
    if (!isValid) return;
    setSaving(true);
    try {
      const res = await fetch(patchEndpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone.trim() }),
      });
      if (!res.ok) throw new Error();

      if (user) setUser({ ...user, name: name.trim(), email: email.trim(), phone: phone.trim() });
      toast({ variant: "success", title: "Profile updated" });
      router.push(basePath);
    } catch {
      toast({ variant: "destructive", title: "Failed to save changes" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link href={basePath}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Profile
        </Link>
      </Button>
      <PageHeader title="Edit My Profile" description="Update your account details" />

      <Card>
        <CardContent className="p-6 space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Full Name <span className="text-destructive">*</span></Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
              </div>
              <div className="space-y-2">
                <Label>Email <span className="text-destructive">*</span></Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@vishnu.edu.in" />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button variant="outline" onClick={() => router.push(basePath)}>Cancel</Button>
                <Button onClick={handleSave} loading={saving} disabled={!isValid}>Save Changes</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
