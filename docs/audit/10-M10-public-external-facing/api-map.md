# M10 — API Map

| Endpoint | Method | Auth | Roles | SM | DB | Notes |
|---|---|---|---|---|---|---|
| `/api/public/candidate-form/[collegeId]/[candidateId]` | GET?, POST | public (path ids) | candidate | SM1 | candidates, candidateApplications | into M2 |
| `/api/public/offer-acceptance/[collegeId]/[offerId]` | GET?, POST | public (path ids) | candidate | SM3 | offerLetters | status machine |
| `/api/public/faculty-public` | GET | public | visitor | SM4 | facultyMembers/users (+M8 projections) | read-only |
| `/api/college/colleges-directory` | GET | public or college guard `[UNVERIFIED]` | visitor | SM2 | colleges | careers data |
| `/api/public/student-feedback` | POST | public (path ids) | student | (M9) | studentFeedback | |
| uploads (resume/certificate) | POST | mixed `[UNVERIFIED public variants]` | candidate | SM1 | Storage | |
| `/api/location-interview/[id]` backing | `[UNVERIFIED — no api/location-interview route found in inventory]` | | | SM5 | `[GAP — confirm implementation location]` | |

Note: no `api/location-interview/*` route appeared in the 301-route inventory — the page's data path needs confirmation `[GAP]`.
