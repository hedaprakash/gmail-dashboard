# ADR-001: Email Evaluation Flow

**Status:** Implemented
**Date:** 2026-01-06
**Decision Makers:** Developer

## Context

The Gmail Dashboard needs to evaluate incoming emails against user-defined criteria to determine what action to take (delete, delete after 1 day, delete after 10 days, keep, or undecided).

### Problem Statement

When users refresh emails from Gmail or click "Re-evaluate", the system needs to:
1. Read all pending emails from the database
2. Match each email against criteria rules (domain, subdomain, email patterns, subject patterns)
3. Determine the appropriate action
4. Store the result for display in the Execute page

### Requirements

- Evaluate hundreds of emails in batch (performance critical)
- Support multi-user isolation (each user sees only their emails)
- Apply 11-level priority matching (email key > fromEmails > toEmails > subject patterns > default)
- Update results directly in the `pending_emails` table

## Decision

Use a SQL Server stored procedure (`EvaluatePendingEmails`) to perform batch evaluation directly in the database.

### Why a Stored Procedure?

1. **Performance**: Evaluating in SQL avoids transferring all emails + criteria to Node.js
2. **Atomicity**: The entire evaluation is a single transaction
3. **Consistency**: Matching logic is centralized in one place
4. **Scalability**: SQL Server handles the join/update operations efficiently

### Data Flow

```
User Action                    API Endpoint                  Database
-----------                    ------------                  --------
"Refresh from Gmail"    -->    POST /api/emails/refresh
                                    |
                                    v
                               Fetch from Gmail API
                                    |
                                    v
                               TRUNCATE pending_emails
                                    |
                                    v
                               Bulk INSERT emails
                                    |
                                    v
                               EXEC EvaluatePendingEmails    --> Updates action, matched_rule, matched_pattern
                                    |
                                    v
                               Return summary counts


"Re-evaluate Emails"    -->    POST /api/execute/evaluate
                                    |
                                    v
                               Reset action = NULL
                                    |
                                    v
                               EXEC EvaluatePendingEmails    --> Updates action, matched_rule, matched_pattern
                                    |
                                    v
                               Return updated counts


Execute Page Load       -->    GET /api/execute/summary
                                    |
                                    v
                               SELECT ... GROUP BY action    --> Returns counts by action type
```

### Stored Procedures Involved

| Procedure | Purpose | Called By |
|-----------|---------|-----------|
| `EvaluatePendingEmails` | Reads from `pending_emails`, evaluates against criteria, updates in place | `/api/emails/refresh`, `/api/execute/evaluate` |
| `EvaluateEmails` | Takes table parameter, returns results (does not update) | Test scripts, ad-hoc evaluation |
| `EvaluateEmailsForUser` | Same as above, filtered by user | Multi-user scenarios |

### Matching Priority (11 Levels)

```
Priority 1:  Email address as top-level key (FROM email is a criteria key)
Priority 2:  fromEmails keep rules
Priority 3:  fromEmails delete rules
Priority 4:  toEmails keep rules
Priority 5:  toEmails delete rules
Priority 6:  Subject keep patterns
Priority 7:  Subject delete patterns
Priority 8:  Subject delete_1d patterns
Priority 9:  Subject delete_10d patterns
Priority 10: Default action (from subdomain or domain)
Priority 11: No match = undecided
```

### Tables Involved

| Table | Purpose |
|-------|---------|
| `pending_emails` | Stores emails awaiting evaluation/deletion |
| `criteria` | Domain/subdomain entries with default actions |
| `patterns` | Subject pattern rules (keep, delete, delete_1d, delete_10d) |
| `email_patterns` | fromEmails/toEmails rules |

## Consequences

### Positive

- Fast batch evaluation (hundreds of emails in <1 second)
- Single source of truth for matching logic
- Easy to test with SQL scripts
- Supports future scaling to thousands of emails

### Negative

- SQL Server dependency (requires Docker container)
- Logic split between TypeScript and SQL (harder to debug)
- Schema changes require both SQL migration and code updates

### Risks

- **Missing stored procedure**: If `EvaluatePendingEmails` doesn't exist, evaluation silently fails
- **Column mismatch**: Code must use exact column names from table schema
- **User scoping**: Both insert and evaluation must include `user_email`

## Implementation Checklist

- [x] Create `pending_emails` table with `user_email` column
- [x] Create `EvaluatePendingEmails` stored procedure
- [x] Modify `/api/emails/refresh` to include `user_email` in bulk insert
- [x] Modify `/api/execute/evaluate` to call stored procedure with user email
- [x] Add E2E tests for refresh → evaluate → execute flow
- [x] Add integration tests for stored procedure execution

## Column Naming Note

The `pending_emails` table uses **PascalCase** column names (GmailId, FromEmail, etc.),
except for `user_email` which was added later and uses snake_case.

```sql
-- Actual column names in pending_emails table:
Id, GmailId, FromEmail, ToEmail, Subject, PrimaryDomain,
Subdomain, EmailDate, ReceivedAt, Action, MatchedRule, user_email
```

## Related Files

| File | Purpose |
|------|---------|
| `scripts/db/07-create-evaluate-pending-procedure.sql` | Creates `EvaluatePendingEmails` |
| `scripts/db/03-create-evaluate-procedure.sql` | Creates `EvaluateEmails` (table parameter version) |
| `scripts/db/06-add-multiuser-support.sql` | Creates `pending_emails` table |
| `server/routes/emails.ts` | Refresh endpoint (bulk insert + evaluate) |
| `server/routes/execute.ts` | Re-evaluate endpoint |

## Test Cases

### Required Tests

1. **Refresh inserts with correct user_email**: Verify bulk insert includes logged-in user's email
2. **Evaluate updates action column**: Verify `EvaluatePendingEmails` sets action correctly
3. **Execute shows evaluated emails**: Verify Execute page displays emails grouped by action
4. **User isolation**: Verify user A cannot see user B's emails
5. **Stored procedure exists**: Verify the procedure can be called without error

### Test Locations

- `tests/e2e.spec.ts` - E2E tests for UI flow
- `tests/integration/email-evaluation.spec.ts` - Integration tests for API + DB
- `scripts/db/05-comprehensive-test.sql` - SQL-level tests for stored procedure

## References

- [SPEC.md](../../SPEC.md) - Full system specification
- [CRITERIA_SPEC.md](../../CRITERIA_SPEC.md) - Criteria format specification
- [scripts/db/README.md](../../scripts/db/README.md) - Database setup guide
