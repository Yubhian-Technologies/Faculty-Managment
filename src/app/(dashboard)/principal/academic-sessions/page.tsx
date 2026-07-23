"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import type { AcademicSession } from "@/types";

export default function AcademicSessionsPage() {
  const [academicSessions, setAcademicSessions] = useState<AcademicSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [newSessionLabel, setNewSessionLabel] = useState("");
  const [savingSession, setSavingSession] = useState(false);
  const [sessionActionId, setSessionActionId] = useState<string | null>(null);

  async function refreshSessions() {
    const data = await fetch("/api/college/academic-sessions")
      .then((r) => r.json() as Promise<{ academicSessions: AcademicSession[] }>);
    setAcademicSessions(data.academicSessions ?? []);
  }

  useEffect(() => {
    setLoading(true);
    refreshSessions()
      .catch(() => toast({ variant: "destructive", title: "Failed to load academic sessions" }))
      .finally(() => setLoading(false));
  }, []);

  async function handleAddSession(e: React.FormEvent) {
    e.preventDefault();
    if (!newSessionLabel.trim()) return;
    setSavingSession(true);
    try {
      const res = await fetch("/api/college/academic-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newSessionLabel.trim() }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to add session", description: json.error });
        return;
      }
      setNewSessionLabel("");
      await refreshSessions();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSavingSession(false);
    }
  }

  async function setCurrentSession(id: string) {
    setSessionActionId(id);
    try {
      const res = await fetch("/api/college/academic-sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isCurrent: true }),
      });
      if (!res.ok) throw new Error();
      await refreshSessions();
    } catch {
      toast({ variant: "destructive", title: "Failed to update session" });
    } finally {
      setSessionActionId(null);
    }
  }

  async function deleteSession(id: string) {
    setSessionActionId(id);
    try {
      const res = await fetch(`/api/college/academic-sessions?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      await refreshSessions();
    } catch {
      toast({ variant: "destructive", title: "Failed to delete session" });
    } finally {
      setSessionActionId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Academic Sessions" description="Calendar sessions for your college" />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Calendar Sessions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Add calendar academic sessions for your college (e.g. &quot;2025-26&quot;) and mark the one currently in effect.
          </p>
          <form onSubmit={handleAddSession} className="flex items-center gap-2">
            <Input
              value={newSessionLabel}
              onChange={(e) => setNewSessionLabel(e.target.value)}
              placeholder="e.g. 2025-26"
              className="flex-1"
            />
            <Button type="submit" size="sm" loading={savingSession} disabled={!newSessionLabel.trim()}>
              Add
            </Button>
          </form>
          {loading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
            </div>
          ) : academicSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No academic sessions added yet.</p>
          ) : (
            <div className="space-y-2">
              {academicSessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{s.label}</span>
                    {s.isCurrent && <Badge className="text-xs">Current</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    {!s.isCurrent && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={sessionActionId === s.id}
                        onClick={() => void setCurrentSession(s.id)}
                      >
                        Set Current
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={sessionActionId === s.id}
                      onClick={() => void deleteSession(s.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
