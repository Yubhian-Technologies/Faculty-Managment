# M11 — Permissions (as-is)

| Action | Library | T&P | IQAC Coordinator | Placement Dept |
|---|---|---|---|---|
| Self attendance | ✅ | ✅ | ✅ | ✅ |
| Dept attendance admin + import | ✅ | ✅ | ➖ | ➖ |
| Leave self-service | ✅ | ✅ | ✅ | ✅ |
| Profile modules | ✅ | ✅ | ✅ | ✅ |
| Domain modules (catalog/drives/etc.) | ➖ (none exist) | ➖ | ➖ | ➖ |

## Scoping & gating
- Role existence gated by college type (`officeRoles.ts`): Degree → IQAC/Placement/Library; Polytechnic → Placement/Library; Engineering/Pharmacy/Dental → all; School → none (AGENTS.md internal-office section; enforced both client picklists and `api/college/users` POST).
- Proxy: each role gets own prefix + `/leave` (proxy.ts).

## Gaps
1. Dept scope for attendance admin of Library/T&P (whose department? their own office department) `[UNVERIFIED]`.
2. Whether IQAC/Placement intentionally lack attendance-admin twins (page count suggests yes).
