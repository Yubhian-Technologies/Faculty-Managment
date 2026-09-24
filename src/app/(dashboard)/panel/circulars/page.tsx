"use client";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { CircularCard } from "@/components/circular/CircularCard";
import { CircularForm } from "@/components/circular/CircularForm";
import { Card, CardContent } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import type { Circular } from "@/types/circular";

export default function PanelCircularsPage() {
  const router = useRouter();
  const [circulars, setCirculars] = useState<Circular[]>([]);
  const [canSend, setCanSend] = useState(true);
  useEffect(() => {
    fetch("/api/college/circulars").then((r) => r.json()).then((j) => setCirculars(j.circulars ?? []));
    // Let server enforce; show form optimistically
  }, []);
  return (
    <div className="space-y-6">
      <PageHeader title="Circulars" description="Published circulars for your audience." />
      {canSend && <CircularForm onCreated={() => { fetch("/api/college/circulars").then((r) => r.json()).then((j) => setCirculars(j.circulars ?? [])); }} />}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {circulars.map((c) => (
          <CircularCard key={c.id} circular={c} onOpen={() => router.push(`/circulars/${c.id}`)} canPublish={c.status === "DRAFT"} onPublish={async () => { await fetch(`/api/college/circulars/${c.id}/publish`, { method: "POST" }); const j = await fetch("/api/college/circulars").then((r) => r.json()); setCirculars(j.circulars ?? []); }} />
        ))}
      </div>
      {circulars.length === 0 && <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No circulars.</CardContent></Card>}
    </div>
  );
}
