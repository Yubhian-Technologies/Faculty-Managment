"use client";

import { useEffect, useState } from "react";
import type { FMSUser } from "@/types";

// The line under the name in the sidebar / mobile-drawer user card. A student's login email is generated from their Roll
// No (<roll>@students.internal) and means nothing to them, so they see their Roll No instead; every other role keeps
// their email exactly as before. A student with no Roll No yet (or while it loads) shows nothing rather than the
// internal address. Display only - nothing about sign-in or roles is read or changed here.

// One lookup per signed-in student per page load, shared by the sidebar and the drawer (both mount together).
let cache: { uid: string; promise: Promise<string> } | null = null;

function fetchRollNumber(uid: string): Promise<string> {
  if (cache?.uid === uid) return cache.promise;
  const promise = fetch("/api/college/student/me/identity", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ rollNumber?: string }>) : { rollNumber: "" }))
    .then((d) => d.rollNumber ?? "")
    .catch(() => "");
  cache = { uid, promise };
  return promise;
}

function StudentRoll({ uid }: { uid: string }) {
  const [roll, setRoll] = useState("");
  useEffect(() => {
    let live = true;
    void fetchRollNumber(uid).then((r) => { if (live) setRoll(r); });
    return () => { live = false; };
  }, [uid]);
  return roll ? <>{roll}</> : null;
}

export function UserCardSubtitle({ user }: { user: Pick<FMSUser, "uid" | "role" | "email"> }) {
  return (
    <p className="text-xs text-muted-foreground truncate">
      {user.role === "STUDENT" ? <StudentRoll uid={user.uid} /> : user.email}
    </p>
  );
}
