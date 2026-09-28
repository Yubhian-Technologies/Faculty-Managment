# Dashboards — ACCOUNTS (`/accounts`) & COLLEGE_ACCOUNTS (`/college-accounts`) (M2)

## ACCOUNTS (11 pages)
| Page | Widgets | API |
|---|---|---|
| `/accounts/pipeline` | AccountsPipelineBoard — detailed hiring status through credential creation (getDetailedHiringStatus/getOnboardingSummary referencedBy) | `offer-letters*`, `faculty-account-requests*` |
| `/accounts/hiring` | Hiring cost views | offer CTC reads |
| `/accounts/salary-structures*` | M7 boundary | `salary-structures` |

## COLLEGE_ACCOUNTS (9 pages)
| Page | Widgets | API |
|---|---|---|
| `/college-accounts/hiring` | CollegeAccountsHiringBoard (same stepper) | same |
| `/college-accounts/candidates` | Candidate verification | `candidates*` |

Guards: ACCOUNTS is GLOBAL-scope ROLE_SCOPE with college dashboard; COLLEGE_ACCOUNTS college-scoped. Both get candidate-profile shared path (proxy).
