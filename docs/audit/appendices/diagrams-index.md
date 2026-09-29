# Appendix — Diagrams Index

All diagrams are Mermaid. Count: 33 diagrams across 29 files.

| # | Type | Location |
|---|---|---|
| 1 | Level-0 system context | `00-overview/system-context.md` |
| 2 | Module dependency graph | `00-overview/module-map.md` |
| 3 | Store landscape | `00-overview/data-stores-overview.md` |
| 4-6 | M1 component · DFD-0 · DFD-L1 · DFD-L2 (users/roles/seats) | `01-M1-…/architecture.md`, `dfd/*` (4) |
| 7-9 | M1 flow sequences (college user, seat, session) | `01-M1-…/flows/*.md` (3) |
| 10-12 | M2 component · DFD-0 · DFD-L1 | `02-M2-…/architecture.md`, `dfd/00,01` (3) |
| 13-14 | M2 DFD-L2 (panel scoring; offer+provisioning) | `02-M2-…/dfd/02-*` (2) |
| 15-17 | M2 sequences (vacancy, offer-accept, panel) | `02-M2-…/flows/vacancy-approval.md` (1), `data-flow.md` (2) |
| 18-20 | M3 component · DFD-0 · DFD-L1 · DFD-L2 (timetable) | `03-M3-…/architecture.md`, `dfd/*` (4) |
| 21 | M3 sequence (draft→publish) | `03-M3-…/data-flow.md` |
| 22-24 | M4 component · DFD-0 · DFD-L1 · DFD-L2 (distribution) · sequences (distribution, promotion via data-flow) | `04-M4-…/architecture.md`, `dfd/*`, `data-flow.md` |
| 25-29 | M5 component · DFD-0 · DFD-L1 · DFD-L2 (student marking) · sequences (check-in, marking, sweep) | `05-M5-…/architecture.md`, `dfd/*`, `data-flow.md`, `flows/*` |
| 30-33 | M6 component · DFD-0 · DFD-L1 · DFD-L2 (approval routing) · sequences (approval, consent) | `06-M6-…/*` |
| 34-37 | M7 component · DFD-0 · DFD-L1 · DFD-L2 (budget lifecycle) · sequences (budget, indent) | `07-M7-…/*` |
| 38-41 | M8 component · DFD-0 · DFD-L1 · DFD-L2 (coordinator review) · sequence | `08-M8-…/*` |
| 42-45 | M9 component · DFD-0 · DFD-L1 · DFD-L2 (publish) · sequence | `09-M9-…/*` |
| 46-48 | M10 component · DFD-0 · DFD-L1 · DFD-L2 (acceptance) · sequence | `10-M10-…/*` |
| 49-51 | M11 component · DFD-0 · DFD-L1 · DFD-L2 (profile modules) · sequence | `11-M11-…/*` |

ER diagrams: M1 (`01-M1/…/data-model.md`), M2, M3, M4, M5, M6, M7, M8, M9, M10, M11 — one per module `data-model.md`.
State machines: rendered as tables + sequences for the key stateful entities — vacancy (M2-F1), batch phases (M2-F4), offer (M2-F3/M10-F1), budget (M7-F1, 10 states), indent (M7-F2, 8 states), timetable draft (M3-F1), attendance session (M5-F2), leave (M6-F1), staff adjustment (M6-F2), account request (M2-F5), faculty account (M1-F2).
