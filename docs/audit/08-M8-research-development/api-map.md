# M8 — API Map

| Endpoint | Method | Auth | Roles | SM | DB | Notes |
|---|---|---|---|---|---|---|
| `/api/college/publications` | GET, POST | requireCollegeMember/verifySession | faculty self, R&D | SM1 | publications | where uid (firestore/publications.ts:9) |
| `/api/college/publications/[id]` | GET, PATCH, DELETE | same | owner/R&D | SM1 | publications | notify on decision |
| `/api/college/publications/import` | POST | requireCollegeMember | R&D | SM1 | publications | Excel |
| `/api/college/citation-metrics` | GET, POST | same | R&D | SM1 | users projection | notifyRole on create |
| `/api/college/citation-metrics/[uid]` | GET, PATCH | same | self/R&D | SM1 | users projection | applyCitationMetricsFields:31-37 |
| `/api/college/research-profile` | GET, POST | same | R&D | SM2 | users projection | notifyRole |
| `/api/college/research-profile/[uid]` | GET, PATCH | same | self/R&D | SM2 | users projection | applyResearchProfileFields:37 |
| `/api/college/consultancy-projects` (+`[id]`) | GET, POST, PATCH | same | faculty/R&D | SM3 | consultancyProjects | finalizeConsultants |
| `/api/college/sponsored-projects` (+`[id]`) | same | same | same | SM3 | sponsoredProjects | |
| `/api/college/seed-funding` (+`[id]`) | same | same | same | SM3 | seedFunding | |
| `/api/college/research-services` (+`[id]`) | same | same | same | SM3 | researchServices | |
| `/api/college/phd-supervision` (+`[id]`) | same | same | same | SM4 | phdSupervision | |
| `/api/college/hackathons` (+`[id]`) | same | same | same | SM4 | hackathons | |
| `/api/college/innovations` (+`[id]`) | same | same | same | SM4 | innovations | |
| `/api/college/discovery-innovation` (+`[id]`) | same | same | same | SM4 | discoveryInnovation | finalizeIprInventors |
| `/api/college/research-review` | GET, POST | requireCollegeMember | RND_COORDINATOR seat, R&D | SM5 | roleSeats + records | seat-gated |
| `/api/upload/{consultancy,sponsored-project,seed-funding,research-service,hackathon,innovation,ipr,phd}-doc` | POST | college guard | owners | SM3/4 | Storage | 8 upload routes |

Verbs on `[id]` routes `[UNVERIFIED]` per-file (DELETE presence varies).
