# M2 — UI Routes (as-is)

```text
# College hiring (college-scoped)
/hod/vacancy · /hod/vacancy/new
/hod/shortlist/[vacancyId]
/hod/batches · /hod/batches/new · /hod/batches/[id]
/hod/candidates · /hod/candidates/new · /hod/candidates/[id]
/hod/pipeline
/principal/vacancies · /[id]/approve · /[id]/reject · /department/[department] · /general-admin
/principal/negotiate/[id] · /principal/decisions/[id] · /principal/interviews · /principal/interviews/[id]
/college-office/candidates · /offers · /offers/new · /pipeline
/college-office/documents · /[department] · /[department]/[vacancyId] · /candidate/[applicationId]
/hr-admin/candidates(+new) · /interviews(+new,[id]) · /offers(+new) · /vacancies(+new,[id]/reject)
/admin-office/vacancies(+new)
/panel/interviews · /[id]
/coordinator/[batchId]
/evaluation/[batchId]/[candidateId]
/candidate-profile/[id]           (shared HOD/Principal/CO/Accounts)
/accounts/hiring · /accounts/pipeline
/college-accounts/candidates · /college-accounts/hiring

# Location hiring
/administration/vacancies(+[id]/reject) · /interviews(+[id],[id]/reject) · /offers(+[id]/reject)
/location-dept-head/vacancies(+new) · /candidates(+new) · /interviews(+[id])
/location-interview/[id]          (public self check-in)

# Webmaster handoff
/webmaster/credential-requests · /webmaster/users · /webmaster/requests

# Public (M10 ingress)
/careers/[collegeId]
/candidate-form/[collegeId]/[candidateId]
/offer-acceptance/[collegeId]/[offerId]

# Super admin
/super-admin/vacancies · /[id]/reject
```

## Guards
- Proxy: role prefixes + shared paths `/panel/interviews`, `/evaluation`, `/candidate-profile`, `/leave` (proxy.ts:35-44, ROLE_PATH_MAP).
- Deep-link params: batchId, candidateId, vacancyId, offerId, applicationId — all college-validated server-side.

## Nav visibility
- Pipeline boards per role; dynamic "My Interviews" for non-embedded roles (navConfig.ts:45-51); `/evaluation` + `/candidate-profile` reachable by multiple roles via ROLE_PATH_MAP.
