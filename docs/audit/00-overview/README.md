# 00-overview — FMS As-Is Audit (index)

Audit performed 2026-09-28 on branch `guna-subjects-timetable-updates`. Static code inspection only; no runtime probing.

| Doc | Contents |
|---|---|
| `system-context.md` | What the system is, actors, Level-0 context diagram |
| `module-map.md` | M1–M11 submodule IDs, evidence mapping, dependency graph, map-vs-code mismatches |
| `cross-cutting-architecture.md` | Auth, tenancy, RBAC, nav visibility, audit, notifications, storage, imports, cron |
| `roles-permissions-matrix.md` | Role registry (29 roles), enforcement points, capability matrix |
| `data-stores-overview.md` | Firestore roots/collections, Auth, Storage, client stores, risks |
| `integrations-and-jobs.md` | Cron, SMTP, PDF, Excel, uploads, face/geo, env surface |
| `traceability-matrix.md` | module → submodule → dashboard → route → API → service → table → tests → doc |
| `gaps-and-risks.md` | Ranked findings (S1–S4) |
| `glossary.md` | Domain terminology matched to code |

Headline stats (verified by file counts on 2026-09-28): **301 API route files**, **570 page files**, **74 test files** (64 unit `.test.ts` + 10 e2e `.spec.ts`... exact split in traceability), 29 `UserRole` values, 1 Cloud Function, 0 external webhooks/queues.
