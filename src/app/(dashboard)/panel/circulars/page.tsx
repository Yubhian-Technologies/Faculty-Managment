"use client";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { CircularCard } from "@/components/circular/CircularCard";
import { CircularForm } from "@/components/circular/CircularForm";
import { Card, CardContent } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import type { Circular } from "@/types/circular";
import { useCanSendCirculars } from "@/hooks/useCanSendCirculars";

// Circulars is an assigned feature: a Panel Member sees the compose form (and,
// via the sidebar/mobile drawer, the tab itself) only when the Principal has
// granted them send-permission in circular-permissions. Server-side routes
// remain the real gate - this page just stops rendering the form optimistically
// and producing 403s for unassigned users.
export default function PanelCircularsPage() {
  const router = useRouter();
  const [circulars, setCirculars] = useState<Circular[]>([]);
  const { canSend } = useCanSendCirculars();

  async function load() {
    const j = await fetch("/api/college/circulars").then((r) => r.json());
    setCirculars(j.circulars ?? []);
  }
  useEffect(() => { void load(); }, []);

  return (
    <div className="space-y-6">
      <PageHeader title="Circulars" description="Published circulars for your audience." />
      {canSend && <CircularForm onCreated={() => void load()} />}
      {canSend === false && (
        <Card>
          <CardContent className="py-3 text-sm text-muted-foreground">
            You have view-only access. Principal has not enabled you to send circulars.
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {circulars.map((c) => (
          <CircularCard
            key={c.id}
            circular={c}
            onOpen={() => router.push(`/circulars/${c.id}`)}
            canPublish={false}
          />
        ))}
      </div>
      {circulars.length === 0 && (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No circulars.</CardContent></Card>
      )}
    </div>
  );
}
