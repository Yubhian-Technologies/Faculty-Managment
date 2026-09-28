# M8 — Research & Development (as-is)

## Purpose
Faculty research record-keeping and review: publications (with Excel import), citation metrics, research profiles, consultancy/sponsored/seed-funded projects, PhD supervision, hackathons, innovations/IPR (discovery-innovation), research services — with a per-department RND Coordinator seat that reviews submissions before they reach R&D.

## Status: Implemented.

## Submodules
| ID | Submodule | Status |
|---|---|---|
| M8-SM1 | Publications & Citation Metrics | Implemented (+import) |
| M8-SM2 | Research Profiles | Implemented |
| M8-SM3 | Projects (Consultancy / Sponsored / Seed-Funded / Research Services) | Implemented |
| M8-SM4 | PhD Supervision, Hackathons, Innovations, IPR (discovery-innovation) | Implemented |
| M8-SM5 | RND Coordinator seat review (`research-review`) | Implemented |

## Dashboards/roles
R_AND_D office role (`/r-and-d`, 22 pages), RND_COORDINATOR seat (`/rnd-coordinator`, 2 pages — layered on a faculty login), faculty self-service via profile module editor (`/[module]` pages), Principal read of research data.

## Dependencies
- Depends on M1 (users, facultyMembers, roleSeats for the coordinator), M9 (notifications).
- Depended on by M1 (profile module pages render research records), M2 (faculty timeline may include research `[UNVERIFIED]`).

## Key code locations
- API: `api/college/publications` (+`[id]`, `/import`), `citation-metrics` (+`[uid]`), `research-profile` (+`[uid]`), `consultancy-projects` (+`[id]`), `sponsored-projects` (+`[id]`), `seed-funding` (+`[id]`), `research-services` (+`[id]`), `phd-supervision` (+`[id]`), `hackathons` (+`[id]`), `innovations` (+`[id]`), `discovery-innovation` (+`[id]`), `research-review`.
- Libs: `src/lib/research/coordinatorReview.ts` (roleSeats lookup :51; faculty/user resolution :75-79), `applyCitationMetricsFields.ts` (faculty where userUid :31; users update :36-37), `applyResearchProfileFields.ts` (:22-37 same shape), `finalizeIprInventors.ts` (college + facultyMembers :19-28), `finalizeConsultants.ts` (:20), `src/lib/publications/firestore/publications.ts` (where uid :9), `resolveOwnerDesignation.ts` (:23), `deriveFlatFields.ts` (:26-34).
- UI: `/r-and-d/**` (publications +new/edit/import, citation-metrics, research-profiles, consultancy-projects, sponsored-projects, seed-funding, research-services, phd-supervision, hackathons, innovations, discovery-innovation, record/[module]/[id]), `/rnd-coordinator`.

## Key stores
`publications`, `citationMetrics`? (fields applied onto users/faculty per apply* libs — storage shape `[UNVERIFIED]`), `consultancyProjects`, `sponsoredProjects`, `seedFunding`, `researchServices`, `phdSupervision`, `hackathons`, `innovations`, `discoveryInnovation`, `roleSeats`, users/facultyMembers (profile field projections).

## Jobs
None.

## Major gaps
1. Citation metrics / research profile storage: fields applied onto `users` docs (:36-37) — dedicated collection existence unverified.
2. RND Coordinator review gating per college type `[UNVERIFIED]` (module map says seat is department-scoped; enforcement read in coordinatorReview.ts uses roleSeats).
3. Publication import validation coverage.
