# Dashboard — HR_ADMIN (M2) (`/hr-admin`, 13 pages)

| Page | Widgets | API |
|---|---|---|
| `/hr-admin/vacancies` (+new, [id]/reject) | Location vacancy list | `api/location/vacancy-requests*` |
| `/hr-admin/candidates` (+new) | Candidate pool | `api/location/candidates*` |
| `/hr-admin/interviews` (+new, [id]) | Interview scheduling | `api/location/interviews*` |
| `/hr-admin/offers` (+new) | Offer issuance | `api/location/offers*` |
| `/hr-admin/profile*` | self | — |

Guard: requireLocationMember; scope: location tenants.
