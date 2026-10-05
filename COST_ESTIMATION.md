# Firestore Cost Estimation
**Scenario:** 30K Students, 2K Faculty, 30 Days, 8 Periods/Day
**Date:** 2026-10-04

## Pricing Assumptions (US multi-region, typical)
| Operation | Rate |
|---|---|
| Reads | .06 per 100,000 |
| Writes | .18 per 100,000 |
| Deletes | .02 per 100,000 |

*(Varies by region/project; excludes storage, egress, network, backups)*

## 30-Day Totals
| Category | Count | Cost (USD) |
|---|---|---|
| Reads | 32,200,000 | .32 |
| Writes | 80,500 | .14 |
| **Total (30 days)** | | **.46** |

## Daily Breakdown
| State | Reads | Writes | Daily Cost |
|---|---|---|---|
| Steady-state (normal term) | ~0.9M | ~1k | ~.54 |
| Blended (avg) | ~1.07M | ~2.7k | ~.65 |
| Peak (timetable prep/publish-heavy) | ~1.3M | ~15k | ~.81 |

**Monthly approx:** .46

## Key Drivers
- **Reads (~95%)**: Timetable grid loads (section-based 	imetableSlots GETs)
- **Writes (~80–90%)**: Publish events (bulk slot materialization)

## 30-Day Volume Summary
| Category | Reads | Writes |
|---|---|---|
| Timetable reads | ~30.66M | — |
| TA reads (GETs) | ~0.97M | — |
| Mutation reads (tx+validation) | ~0.58M | — |
| Publish (bulk slots) | — | ~67.5k |
| Other mutations | — | ~13.0k |
| **Totals** | **~32.21M** | **~80.5k** |

## Optimization Notes
- **Windowed reads on publish**: cut publish queries (14k → ~1+17); modest cost reduction (~–/month)
- **Narrow roster queries**: reduce lent-out read amplification
- **Composite indexes** on timetableSlots (sectionId, academicYear, semester) and (facultyId, academicYear, semester, day, periodNumber): better server-side filtering & tx efficiency

*Full audit details available in conversation context.*
