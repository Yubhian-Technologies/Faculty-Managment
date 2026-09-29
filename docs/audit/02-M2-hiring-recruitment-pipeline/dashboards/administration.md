# Dashboards — ADMINISTRATION & LOCATION_DEPT_HEAD (M2)

## ADMINISTRATION (20 pages, hiring subset)
| Page | Widgets | API |
|---|---|---|
| `/administration/vacancies` (+[id]/reject) | Location/general-admin vacancy oversight | `location/vacancy-requests*`, `admin/general-admin-vacancies*` |
| `/administration/interviews` (+[id], [id]/reject) | Location interviews | `location/interviews*` |
| `/administration/offers` (+[id]/reject) | Location offers | `location/offers*` |

## LOCATION_DEPT_HEAD (19 pages, hiring subset)
| Page | Widgets | API |
|---|---|---|
| `/location-dept-head/vacancies` (+new) | Dept vacancy requests | `location/vacancy-requests*` |
| `/location-dept-head/candidates` (+new) | Candidate pool | `location/candidates*` |
| `/location-dept-head/interviews` (+[id]) | Interview ops | `location/interviews*` |

Guards: requireLocationMember. Public `/location-interview/[id]` ties in for check-in `[GAP — backing API unconfirmed]`.
