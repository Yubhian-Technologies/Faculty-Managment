# C. General Admin Pipeline

Tenancy: global (`generalAdminVacancies` root collection). A pure two-step headcount approval — no candidates, interviews, offers, or faculty provisioning.

See [README.md](README.md) for the flow notation (`Role -action-> Result -> Role`).

## Stage 1 — Submit

```
VICE_PRINCIPAL (or PRINCIPAL / SUPER_ADMIN) -submit vacancy [POST /api/admin/general-admin-vacancies]-> GeneralAdminVacancy{status: PENDING, positionCategory: GENERAL_ADMIN} -> SUPER_ADMIN
```
- Creates the doc in the root `generalAdminVacancies` collection (not college-scoped).
- Notifies every `systemUsers` doc with `role === "SUPER_ADMIN"` by writing to the root `systemNotifications` collection, `type: "GENERAL_ADMIN_VACANCY"` — this is its own ad hoc notification shape/collection, separate from `AppNotification`, and `"GENERAL_ADMIN_VACANCY"` is **not** in the `NotificationType` union.
- Source: `src/app/api/admin/general-admin-vacancies/route.ts:31-106`.

## Stage 2 — Decision (terminal)

```
SUPER_ADMIN -approve [PATCH /api/admin/general-admin-vacancies/[id]]-> GeneralAdminVacancy{status: APPROVED, superAdminResponse} -> submitter (terminal)
SUPER_ADMIN -reject-> GeneralAdminVacancy{status: REJECTED, superAdminResponse} -> submitter (terminal)
```
- Notifies the submitter via `colleges/{vacancy.collegeId}/notifications` (`type: VACANCY_APPROVED|VACANCY_REJECTED`, link `/principal/vacancies`).
- No audit log write.
- Source: `src/app/api/admin/general-admin-vacancies/[id]/route.ts:8-80`.

## Footgun: two pipelines share one `positionCategory` value

`positionCategory: "GENERAL_ADMIN"` can end up in **either**:
- `colleges/{id}/vacancyRequests` — goes through the full [College pipeline](college-pipeline.md) HOD/Principal flow (though that route only allows `VICE_PRINCIPAL`/`SUPER_ADMIN` to set this category there), **or**
- `generalAdminVacancies` (this pipeline) — the dedicated VP → Super Admin approval, structurally unrelated to the college collection above.

Which one a given "General Admin" vacancy lives in depends entirely on which route/UI page created it — the shared category label doesn't imply a shared pipeline. Treat these as two independent things that happen to look the same in the UI.
