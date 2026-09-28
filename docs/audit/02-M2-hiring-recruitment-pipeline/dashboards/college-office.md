# Dashboard — COLLEGE_OFFICE (M2 surfaces) (`/college-office`)

- **Role:** COLLEGE_OFFICE (L4, college-wide; non-teaching staff owner per AGENTS.md split)
- **M2 pages (of 49):** `/college-office/candidates`, `/college-office/offers`, `/college-office/offers/new`, `/college-office/pipeline`, `/college-office/documents` (+`[department]`, `[department]/[vacancyId]`, `candidate/[applicationId]`), `/college-office/staff` (staffing), `/college-office/staff-attendance*` (M5), `/college-office/non-technical-staff*` (supporting staff), `/college-office/settings/faculty-credentials`
- **Guard:** requireCollegeMember; candidate-profile path shared (proxy CANDIDATE_PROFILE_PATH).

## Widgets/tables and data sources
| Page | Widgets | API | Notes |
|---|---|---|---|
| `/college-office/pipeline` | Office pipeline board | OfficePipelineBoard.tsx + getCurrentStage/getDetailedHiringStatus | |
| `/college-office/offers*` | Offer list/create/send, request-faculty-account button | `api/college/offer-letters*`, `faculty-account-requests*` | CC + webmaster handoff |
| `/college-office/candidates` | Candidate table | `api/college/candidates*` | |
| `/college-office/documents/**` | Document vault per department/vacancy/candidate | uploads + candidate docs | certificate/resume downloads |
| `/college-office/settings/faculty-credentials` | Credential rules | `[UNVERIFIED — likely faculty-account-requests config]` | |

## Filters/scopes
- College-wide (not department-scoped).

## Permissions
- Backend guards; frontend nav; isCollegeAdmin exceptions n/a here.

## Drill-downs
- Pipeline → offer → documents → account request.

## Export/report
- Document downloads (PDFs).

## Code evidence
- Page inventory; getDetailedHiringStatus referencedBy includes `college-office/documents/**` and `OfficePipelineBoard.tsx`.
