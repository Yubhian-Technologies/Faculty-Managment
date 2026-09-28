# M9 — UI Routes (as-is)

```text
/principal/circulars              composer + settings (Principal/VP)
/hod/circulars                    read (Megaphone nav)
/panel/circulars                  read
/panel/feedback                   feedback recipient view
/exam-cell/circulars              exam module circulars (M3 boundary)
/circulars/[id]                   shared viewer (print/download) — proxy-granted to leadership+HOD paths
/feedback/[id]/[sub] (+/[item])   PUBLIC feedback form (proxy PUBLIC_PATHS)
/principal/audit-logs             audit stream (college)
```

Guards: proxy PUBLIC_PATHS covers `/feedback` (proxy.ts:16-30); `/circulars/[id]` is a dashboard route (role paths per ROLE_PATH_MAP — PRINCIPAL etc. include shared circulars? `[UNVERIFIED which roles' maps include /circulars]` `[GAP]`).
