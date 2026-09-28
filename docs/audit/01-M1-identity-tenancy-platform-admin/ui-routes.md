# M1 — UI Routes (as-is)

Route tree (from `src/app/(dashboard)` page inventory; `[UNVERIFIED]` where page purpose inferred from path):

```text
/super-admin                       role: SUPER_ADMIN (proxy)
  ├ /super-admin                   dashboard (stats)
  ├ /super-admin/locations         ├ /new ├ /[id]/edit
  ├ /super-admin/colleges          ├ /new ├ /[id]/edit
  ├ /super-admin/users             ├ /new ├ /[uid] ├ /[uid]/edit ├ /[uid]/[module] ├ /[uid]/[module]/edit
  ├ /super-admin/role-assignments
  ├ /super-admin/settings
  ├ /super-admin/audit-logs
  └ /super-admin/vacancies         ├ /[id]/reject        (M2 boundary)

/administration                    role: ADMINISTRATION (+LOCATION_DEPT_HEAD paths via map)
  ├ /administration                dashboard
  ├ /administration/colleges       ├ /new ├ /[id]/edit ├ /[id]/departments ├ /[id]/departments/[deptId] ├ /[id]/people/new
  ├ /administration/users          ├ /new ├ /[uid]/edit
  ├ /administration/principals
  ├ /administration/settings
  ├ /administration/profile        ├ /edit
  ├ /administration/vacancies      ├ /new? ├ /[id]/reject     (M2)
  ├ /administration/interviews     ├ /[id] ├ /[id]/reject     (M2)
  └ /administration/offers         ├ /new? ├ /[id]/reject     (M2)

/webmaster                         role: WEBMASTER
  ├ /webmaster                     dashboard
  ├ /webmaster/credential-requests
  ├ /webmaster/users
  ├ /webmaster/requests
  ├ /webmaster/history
  ├ /webmaster/leave (+apply, history/[type])   (M6 reuse)
  └ /webmaster/profile             ├ /edit ├ /[module] ├ /[module]/edit

/management                        role: MANAGEMENT
  ├ /management                    home
  ├ /management/dashboard
  ├ /management/locations          ├ /new
  ├ /management/users              ├ /new
  ├ /management/role-assignments
  ├ /management/faculty            ├ /[collegeId] ├ /[collegeId]/departments/… ├ /[collegeId]/principal[/module] ├ /[collegeId]/vice-principal[/module] ├ /[collegeId]/faculty-attendance/[uid]
  ├ /management/attendance
  ├ /management/budget             ├ /[collegeId]   (M7 read)
  ├ /management/indents
  ├ /management/leave-approvals    (M6)
  └ /management/profile            ├ /edit
```

## Guards
- Edge: `src/proxy.ts` ROLE_PATH_MAP (SUPER_ADMIN → `/super-admin` + shared panel/evaluation; MANAGEMENT → `/management`; ADMINISTRATION triple; WEBMASTER → `/webmaster` + `/leave`).
- Page-level: `useAuth` redirect to dashboard path when role mismatch `[ASSUMPTION — hook-based]`.

## Navigation visibility
- `navConfig.ts` items per role; college toggles filter (hiddenModules/hiddenItems); `BOTTOM_NAV_ITEMS` for mobile hand-maintained.

## Deep links / query params
- `/login?redirect=<path>` (proxy.ts:114-116,122-124).
- Module editor deep links: `/super-admin/users/[uid]/[module]/edit` (per-user module edit).
