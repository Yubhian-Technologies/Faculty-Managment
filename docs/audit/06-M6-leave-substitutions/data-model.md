# M6 — Data Model (as-is)

## Entities

| Entity | Path | Key fields | Evidence |
|---|---|---|---|
| LeaveRequest | `colleges/{id}/leaveRequests/{id}` | uid, type (CL/SL/SCL/EL/OD/SH — leave.ts:31), from/to, status workflow, adjustment fields (requested/accepted substitute), stages | balanceEngine.ts:40 |
| EmployeeLeaveProfile | `colleges/{id}/employeeLeaveProfiles/{uid}` | annual entitlements per type | balanceEngine.ts:43 |
| LeaveBalance | `colleges/{id}/leaveBalances/{uid}_{year?}` | per-type remaining | balanceEngine.ts:37 |
| StaffAdjustment | `colleges/{id}/staffAdjustments/{id}` | user, substitute, dates, status ACTIVE/CANCELLED (leave.ts:296) | availability.ts:120 |
| OtherLeaveCategory | `colleges/{id}/otherLeaveCategories/{id}` | custom type defs | otherCategories.ts:9 |
| PermissionRequest | `colleges/{id}/permissionRequests/{id}` | short-leave window, status | permission.ts:19 |
| OnDutyRequest | `colleges/{id}/onDutyRequests/{id}` | OD with proof URL | odProof |
| Holiday | `colleges/{id}/holidays|summerHolidays` | date ranges | holidaysCount.ts:26-94 |

## Mermaid ER

```mermaid
erDiagram
    USER ||--o{ LEAVE_REQUEST : files
    USER ||--|| LEAVE_PROFILE : has
    USER ||--o{ LEAVE_BALANCE : "per year"
    USER ||--o{ STAFF_ADJUSTMENT : "subject of"
    USER ||--o{ STAFF_ADJUSTMENT : "substitute in"
    USER ||--o{ PERMISSION_REQUEST : files
    USER ||--o{ ONDUTY_REQUEST : files
    LEAVE_REQUEST ||--o| STAFF_ADJUSTMENT : "substitution"
    LEAVE_TYPE ||--o{ LEAVE_REQUEST : typed
    LEAVE_REQUEST {
        string id PK
        string uid FK
        string type
        string status
        string from
        string to
    }
    STAFF_ADJUSTMENT {
        string id PK
        string userId FK
        string substituteId FK
        string status
    }
```

## Indexes
- leaveRequests: [uid,createdAt↓], [department,status,createdAt↓], [status,createdAt↓], COLLECTION_GROUP [status]; permissionRequests: [facultyId,date↓], [department,status]; onDutyRequests: [facultyId,fromDate↓], [department,status].
