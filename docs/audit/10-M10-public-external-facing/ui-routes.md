# M10 — UI Routes (as-is)

```text
/                                  landing (public; client redirect if signed-in — proxy.ts:9-12)
/careers/[collegeId]               vacancies per college
/candidate-form/[collegeId]/[candidateId]
/offer-acceptance/[collegeId]/[offerId]
/faculty-public/[param]            public profile
/faculty-public/demo               demo route
/location-interview/[id]           candidate self check-in
/feedback/[id]/[sub] (+/[item])    student feedback wizard
/candidate-profile/[id]            AUTH'd shared dossier (not public — proxy CANDIDATE_PROFILE_PATH)
```

Guards: proxy PUBLIC_PATHS exact list (proxy.ts:16-30): `/`, `/login`, `/careers`, `/feedback`, `/api/auth`, `/location-interview`, `/candidate-form`, `/offer-acceptance`, `/faculty-public`, one legacy vscode-resource png entry (hygiene oddity), `/models`.
Deep-link params: collegeId, candidateId, offerId, interview id, feedback ids — all capability-bearing.
