"use client";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { CircularCard } from "@/components/circular/CircularCard";
import { CircularForm } from "@/components/circular/CircularForm";
import { Card, CardContent } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import type { Circular } from "@/types/circular";

export default function HodCircularsPage() {
  const router = useRouter();
  const [circulars, setCirculars] = useState<Circular[]>([]);
  const [canSend, setCanSend] = useState<boolean | null>(null);

  async function load() {
    const c = await fetch("/api/college/circulars").then((r) => r.json());
    setCirculars(c.circulars ?? []);
    // Optimistically show form; server enforces 403 on POST/publish if not permitted
    setCanSend(true);
  }
  useEffect(() => { void load(); }, []);

  return (
    <div className="space-y-6">
      <PageHeader title="Circulars" description="View circulars for your college. If enabled by Principal, you can also publish." />
      {canSend !== false && <CircularForm onCreated={() => void load()} />}
      {canSend === false && <Card><CardContent className="py-3 text-sm text-muted-foreground">You have view-only access. Principal has not enabled you to send circulars.</CardContent></Card>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {circulars.map((c) => (
          <CircularCard
            key={c.id}
            circular={c}
            canPublish={c.status === "DRAFT"}
            onOpen={() => router.push(`/circulars/${c.id}`)}
            onPublish={async () => {
              await fetch(`/api/college/circulars/${c.id}/publish`, { method: "POST" });
              void load();
            }}
          />
        ))}
      </div>
      {circulars.length === 0 && <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No circulars.</CardContent></Card>}
    </div>
  );
}
