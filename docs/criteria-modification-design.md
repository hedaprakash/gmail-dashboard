# Criteria Modification System - Comprehensive Design Document

## Overview

This document defines the unified approach for all criteria modifications in the Gmail Dashboard system. All modifications flow through a single stored procedure (`ModifyCriteria`) with built-in audit logging and comprehensive test coverage.

---

## 1. System Architecture

### 1.1 Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Frontend (React)                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Review Page  │  │   Criteria   │  │   Execute    │  │    Stats     │ │
│  │              │  │   Manager    │  │    Page      │  │    Page      │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────────────┘ │
│         │                 │                 │                            │
│         └─────────────────┼─────────────────┘                            │
│                           ▼                                              │
│              ┌────────────────────────┐                                  │
│              │  POST /api/criteria    │                                  │
│              │  (Unified Endpoint)    │                                  │
│              └────────────┬───────────┘                                  │
└───────────────────────────┼──────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Backend (Express.js)                              │
│              ┌────────────────────────┐                                  │
│              │  routes/criteria.ts    │                                  │
│              │  (Route Handler)       │                                  │
│              └────────────┬───────────┘                                  │
│                           │                                              │
│                           ▼                                              │
│              ┌────────────────────────┐                                  │
│              │  services/database.ts  │                                  │
│              │  (SQL Execution)       │                                  │
│              └────────────┬───────────┘                                  │
└───────────────────────────┼──────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        SQL Server                                        │
│              ┌────────────────────────┐                                  │
│              │  EXEC ModifyCriteria   │                                  │
│              │  @Operation = '...'    │                                  │
│              │  @Dimension = '...'    │                                  │
│              │  @Action = '...'       │                                  │
│              │  @KeyValue = '...'     │                                  │
│              │  @UserEmail = '...'    │                                  │
│              └────────────┬───────────┘                                  │
│                           │                                              │
│                           ▼                                              │
│   ┌────────────┐   ┌────────────┐   ┌────────────────┐   ┌───────────┐  │
│   │  criteria  │   │  patterns  │   │ email_patterns │   │ audit_log │  │
│   │   table    │   │   table    │   │     table      │   │   table   │  │
│   └────────────┘   └────────────┘   └────────────────┘   └───────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Key Principles

1. **Single Entry Point**: All modifications go through `ModifyCriteria` stored procedure
2. **Built-in Audit Logging**: Every operation is logged automatically
3. **User Isolation**: All data scoped by `user_email`
4. **Idempotent Operations**: Running same operation twice has same result
5. **Conflict Resolution**: Clear priority rules when rules conflict

---

## 2. Dimensions

The system supports 6 dimensions for criteria matching:

| Dimension | Table | Description | Example |
|-----------|-------|-------------|---------|
| **Domain** | `criteria` | Top-level domain rules | `example.com` |
| **Subdomain** | `criteria` | Rules for specific subdomains | `mail.example.com` |
| **Email Address** | `criteria` | Rules for specific sender emails | `noreply@example.com` |
| **Subject Pattern** | `patterns` | Match subject line text | `newsletter`, `verification` |
| **From Email** | `email_patterns` | Match sender address | `support@example.com` |
| **To Email** | `email_patterns` | Match recipient address | `myalias@gmail.com` |

### 2.1 Matching Priority (Highest to Lowest)

```
1. Email Address as top-level key (criteria.key_type = 'email')
2. From Email keep rules (email_patterns.direction = 'from', action = 'keep')
3. From Email delete rules (email_patterns.direction = 'from', action = 'delete')
4. To Email keep rules (email_patterns.direction = 'to', action = 'keep')
5. To Email delete rules (email_patterns.direction = 'to', action = 'delete')
6. Subject keep patterns (patterns.action = 'keep')
7. Subject delete patterns (patterns.action = 'delete')
8. Subject delete_1d patterns (patterns.action = 'delete_1d')
9. Subject delete_10d patterns (patterns.action = 'delete_10d')
10. Subdomain default action (criteria.key_type = 'subdomain')
11. Domain default action (criteria.key_type = 'domain')
12. No match = 'undecided'
```

---

## 3. Operations

### 3.1 Operation Types

| Operation | Description |
|-----------|-------------|
| `ADD` | Add a new rule (creates if not exists) |
| `REMOVE` | Remove an existing rule |
| `UPDATE` | Change an existing rule's action |
| `GET` | Retrieve rules (for viewing) |
| `CLEAR` | Remove all rules for a dimension |

### 3.2 Action Types

| Action | Description | Use Case |
|--------|-------------|----------|
| `delete` | Delete immediately | Spam, unwanted promotions |
| `delete_1d` | Delete if >1 day old | OTPs, verification codes |
| `delete_10d` | Delete if >10 days old | Receipts, monthly reports |
| `keep` | Never delete | Important emails |

---

## 4. Stored Procedure Interface

### 4.1 Parameters

```sql
CREATE PROCEDURE dbo.ModifyCriteria
    @Operation NVARCHAR(10),      -- ADD, REMOVE, UPDATE, CLEAR
    @Dimension NVARCHAR(20),      -- domain, subdomain, email, subject, from_email, to_email
    @Action NVARCHAR(20),         -- delete, delete_1d, delete_10d, keep
    @KeyValue NVARCHAR(255),      -- The value (domain name, pattern, email)
    @UserEmail NVARCHAR(255),     -- User's email (for multi-user isolation)
    @ParentDomain NVARCHAR(255) = NULL,  -- Parent domain (for subdomains/patterns)
    @ParentSubdomain NVARCHAR(255) = NULL, -- Parent subdomain (for subdomain patterns)
    @OldAction NVARCHAR(20) = NULL -- For UPDATE: the action being changed from
AS
```

### 4.2 Return Values

```sql
-- Returns a result set:
SELECT
    @Success AS Success,           -- 1 = success, 0 = failure
    @Message AS Message,           -- Human-readable message
    @RecordId AS RecordId,         -- ID of affected record (or NULL)
    @AuditId AS AuditId           -- ID of audit log entry
```

### 4.3 Audit Log Entry

Every operation automatically creates an audit log entry:

```sql
INSERT INTO audit_log (
    user_email,      -- Who made the change
    action_type,     -- INSERT, UPDATE, DELETE
    table_name,      -- criteria, patterns, or email_patterns
    record_id,       -- ID of affected record
    domain,          -- Domain context
    details,         -- JSON with full operation details
    created_at       -- Timestamp
)
```

---

## 5. Test Scenarios

### 5.1 Domain Operations (D01-D10)

Operations from Review Page when user clicks domain-level actions.

| ID | Scenario | Input | Expected Result |
|----|----------|-------|-----------------|
| **D01** | Add domain delete rule | `{Op: ADD, Dim: domain, Action: delete, Key: "spam.com"}` | Creates criteria entry with default_action='delete' |
| **D02** | Add domain keep rule | `{Op: ADD, Dim: domain, Action: keep, Key: "important.com"}` | Creates criteria entry with default_action='keep' |
| **D03** | Add domain delete_1d rule | `{Op: ADD, Dim: domain, Action: delete_1d, Key: "otp.com"}` | Creates criteria entry with default_action='delete_1d' |
| **D04** | Add domain delete_10d rule | `{Op: ADD, Dim: domain, Action: delete_10d, Key: "reports.com"}` | Creates criteria entry with default_action='delete_10d' |
| **D05** | Remove domain rule | `{Op: REMOVE, Dim: domain, Key: "spam.com"}` | Removes criteria entry and all child patterns/subdomains |
| **D06** | Change domain delete to keep | `{Op: UPDATE, Dim: domain, Action: keep, Key: "changed.com", OldAction: delete}` | Updates default_action from 'delete' to 'keep' |
| **D07** | Add duplicate domain (idempotent) | `{Op: ADD, Dim: domain, Action: delete, Key: "spam.com"}` x2 | Second call succeeds, no duplicate created |
| **D08** | Remove non-existent domain | `{Op: REMOVE, Dim: domain, Key: "notfound.com"}` | Returns success=true, message="No matching rule found" |
| **D09** | Clear all domain rules | `{Op: CLEAR, Dim: domain, Key: "cleanup.com"}` | Removes domain and ALL associated rules (patterns, subdomains) |
| **D10** | Get domain rules | `{Op: GET, Dim: domain, Key: "example.com"}` | Returns domain info with all patterns and subdomains |

### 5.2 Subdomain Operations (S01-S10)

Operations for subdomain-specific rules.

| ID | Scenario | Input | Expected Result |
|----|----------|-------|-----------------|
| **S01** | Add subdomain delete rule | `{Op: ADD, Dim: subdomain, Action: delete, Key: "mail", Parent: "example.com"}` | Creates subdomain criteria under domain |
| **S02** | Add subdomain keep rule | `{Op: ADD, Dim: subdomain, Action: keep, Key: "support", Parent: "example.com"}` | Creates subdomain with keep action |
| **S03** | Add subdomain delete_1d rule | `{Op: ADD, Dim: subdomain, Action: delete_1d, Key: "notify", Parent: "example.com"}` | Creates subdomain with delete_1d action |
| **S04** | Add subdomain delete_10d rule | `{Op: ADD, Dim: subdomain, Action: delete_10d, Key: "archive", Parent: "example.com"}` | Creates subdomain with delete_10d action |
| **S05** | Remove subdomain rule | `{Op: REMOVE, Dim: subdomain, Key: "mail", Parent: "example.com"}` | Removes subdomain and its patterns |
| **S06** | Update subdomain action | `{Op: UPDATE, Dim: subdomain, Action: keep, Key: "promo", Parent: "example.com", OldAction: delete}` | Changes subdomain action |
| **S07** | Add subdomain pattern | `{Op: ADD, Dim: subject, Action: keep, Key: "urgent", Parent: "example.com", ParentSub: "mail"}` | Adds pattern under subdomain |
| **S08** | Remove subdomain pattern | `{Op: REMOVE, Dim: subject, Key: "urgent", Parent: "example.com", ParentSub: "mail"}` | Removes specific pattern from subdomain |
| **S09** | Subdomain inherits domain action | `{Op: GET, Dim: subdomain, Key: "new", Parent: "delete-domain.com"}` | Returns inherited action when subdomain has no explicit rule |
| **S10** | Subdomain overrides domain action | `{Op: GET, Dim: subdomain, Key: "important", Parent: "delete-domain.com"}` where subdomain.action='keep' | Subdomain keep overrides domain delete |

### 5.3 Subdomain Review Operations (SR01-SR06)

Operations from Criteria Manager page when reviewing/modifying existing subdomain rules.

| ID | Scenario | Input | Expected Result |
|----|----------|-------|-----------------|
| **SR01** | List all subdomains for domain | `{Op: GET, Dim: subdomain, Parent: "example.com"}` (Key=null) | Returns all subdomains with their actions and pattern counts |
| **SR02** | View subdomain with patterns | `{Op: GET, Dim: subdomain, Key: "mail", Parent: "example.com"}` | Returns subdomain details + all subject patterns |
| **SR03** | Edit subdomain default action | `{Op: UPDATE, Dim: subdomain, Action: delete_1d, Key: "mail", Parent: "example.com", OldAction: delete}` | Updates subdomain's default_action, logs change |
| **SR04** | Delete subdomain from manager | `{Op: REMOVE, Dim: subdomain, Key: "obsolete", Parent: "example.com"}` | Removes subdomain + all its patterns, cascading delete |
| **SR05** | Search subdomains by pattern | Query: `WHERE key_value LIKE '%search%' AND key_type='subdomain'` | Returns matching subdomains across all domains |
| **SR06** | Bulk subdomain action change | Multiple `UPDATE` calls via transaction | All succeed or all rollback |

### 5.4 Email Pattern Operations (E01-E10)

Operations for fromEmail and toEmail rules.

| ID | Scenario | Input | Expected Result |
|----|----------|-------|-----------------|
| **E01** | Add fromEmail keep rule | `{Op: ADD, Dim: from_email, Action: keep, Key: "ceo@company.com", Parent: "company.com"}` | Creates email_pattern with direction='from' |
| **E02** | Add fromEmail delete rule | `{Op: ADD, Dim: from_email, Action: delete, Key: "spam@company.com", Parent: "company.com"}` | Creates email_pattern with delete action |
| **E03** | Add toEmail keep rule | `{Op: ADD, Dim: to_email, Action: keep, Key: "work@gmail.com", Parent: "company.com"}` | Creates email_pattern with direction='to' |
| **E04** | Add toEmail delete rule | `{Op: ADD, Dim: to_email, Action: delete, Key: "promo@gmail.com", Parent: "company.com"}` | Creates email_pattern with delete action |
| **E05** | Remove fromEmail rule | `{Op: REMOVE, Dim: from_email, Key: "spam@company.com", Parent: "company.com"}` | Removes specific email pattern |
| **E06** | Remove toEmail rule | `{Op: REMOVE, Dim: to_email, Key: "promo@gmail.com", Parent: "company.com"}` | Removes specific email pattern |
| **E07** | Update fromEmail action | `{Op: UPDATE, Dim: from_email, Action: keep, Key: "sender@company.com", OldAction: delete}` | Changes from delete to keep |
| **E08** | Duplicate fromEmail (idempotent) | `{Op: ADD, Dim: from_email, Action: keep, Key: "ceo@company.com"}` x2 | No duplicate, success on both |
| **E09** | FromEmail overrides domain action | Domain=delete, fromEmail=keep for `ceo@company.com` | Email from CEO is kept despite domain delete |
| **E10** | ToEmail filters by recipient | toEmail=delete for `promo@gmail.com` | Only emails TO that alias are deleted |

### 5.5 Subject Pattern Operations (P01-P10)

Operations for subject line pattern matching.

| ID | Scenario | Input | Expected Result |
|----|----------|-------|-----------------|
| **P01** | Add subject keep pattern | `{Op: ADD, Dim: subject, Action: keep, Key: "urgent", Parent: "example.com"}` | Creates pattern with action='keep' |
| **P02** | Add subject delete pattern | `{Op: ADD, Dim: subject, Action: delete, Key: "newsletter", Parent: "example.com"}` | Creates pattern with action='delete' |
| **P03** | Add subject delete_1d pattern | `{Op: ADD, Dim: subject, Action: delete_1d, Key: "verification code", Parent: "example.com"}` | Creates pattern with action='delete_1d' |
| **P04** | Add subject delete_10d pattern | `{Op: ADD, Dim: subject, Action: delete_10d, Key: "monthly report", Parent: "example.com"}` | Creates pattern with action='delete_10d' |
| **P05** | Remove subject pattern | `{Op: REMOVE, Dim: subject, Key: "newsletter", Parent: "example.com"}` | Removes specific pattern |
| **P06** | Update subject pattern action | `{Op: UPDATE, Dim: subject, Action: keep, Key: "important", OldAction: delete}` | Changes pattern action |
| **P07** | Add pattern to subdomain | `{Op: ADD, Dim: subject, Action: delete, Key: "promo", Parent: "example.com", ParentSub: "mail"}` | Pattern linked to subdomain criteria |
| **P08** | Case-insensitive matching | Pattern: "URGENT", Subject: "urgent update" | Matches (case insensitive) |
| **P09** | Partial match | Pattern: "verify", Subject: "Please verify your email" | Matches (substring) |
| **P10** | Multiple patterns same domain | Add "promo", "newsletter", "digest" to same domain | All patterns created, all evaluated |

### 5.6 Change/Update Operations (C01-C08)

Operations for modifying existing rules.

| ID | Scenario | Input | Expected Result |
|----|----------|-------|-----------------|
| **C01** | Change delete to keep | `{Op: UPDATE, Dim: domain, Action: keep, Key: "changed.com", OldAction: delete}` | Action updated, audit logged |
| **C02** | Change keep to delete | `{Op: UPDATE, Dim: domain, Action: delete, Key: "changed.com", OldAction: keep}` | Action updated, audit logged |
| **C03** | Change delete to delete_1d | `{Op: UPDATE, Dim: domain, Action: delete_1d, Key: "otp.com", OldAction: delete}` | Action updated |
| **C04** | Change delete_1d to delete_10d | `{Op: UPDATE, Dim: subject, Action: delete_10d, Key: "report", OldAction: delete_1d}` | Pattern action updated |
| **C05** | Update non-existent rule | `{Op: UPDATE, Dim: domain, Action: keep, Key: "notfound.com"}` | Returns error: "Rule not found" |
| **C06** | Update with same action | `{Op: UPDATE, Dim: domain, Action: delete, Key: "spam.com", OldAction: delete}` | Success, no actual change |
| **C07** | Cascade update subdomain | Update domain action when subdomains exist | Subdomains retain their own actions |
| **C08** | Audit log tracks old/new | Any UPDATE operation | Audit details contain before/after values |

### 5.7 Conflict Resolution (X01-X08)

Test scenarios for priority and conflict handling.

| ID | Scenario | Setup | Expected Evaluation |
|----|----------|-------|---------------------|
| **X01** | FromEmail keep vs Domain delete | Domain: delete, FromEmail: keep | Result: keep (fromEmail wins) |
| **X02** | Subject keep vs Domain delete | Domain: delete, Pattern: keep | Result: keep (pattern wins) |
| **X03** | Subject delete vs Subject keep | Both patterns exist | Result: keep (keep wins over delete) |
| **X04** | Subdomain vs Domain | Domain: delete, Subdomain: keep | Result: keep (subdomain wins) |
| **X05** | Email address vs Domain | Email key: delete, Domain: keep | Result: delete (email key wins) |
| **X06** | Multiple subject patterns | keep:"urgent", delete:"newsletter" | First match wins by priority |
| **X07** | ToEmail vs FromEmail | FromEmail: keep, ToEmail: delete | Result: keep (fromEmail priority) |
| **X08** | No rules match | New domain, no criteria | Result: undecided |

### 5.8 Multi-User Isolation (U01-U05)

Verify user data isolation.

| ID | Scenario | Setup | Expected Result |
|----|----------|-------|-----------------|
| **U01** | User A adds rule | UserA: ADD domain delete "spam.com" | Only visible to UserA |
| **U02** | User B cannot see User A rules | UserB: GET domain "spam.com" | Returns empty/not found |
| **U03** | User B adds same domain | UserB: ADD domain keep "spam.com" | Creates separate entry for UserB |
| **U04** | User A removes rule | UserA: REMOVE domain "spam.com" | UserB's rule unaffected |
| **U05** | Stats are user-scoped | GET stats for UserA and UserB | Different counts per user |

---

## 6. API Request/Response Format

### 6.1 Unified API Endpoint

```
POST /api/criteria/modify
Content-Type: application/json
Authorization: Session cookie (contains user email)
```

### 6.2 Request Body Structure

```typescript
interface CriteriaModifyRequest {
  operation: 'ADD' | 'REMOVE' | 'UPDATE' | 'CLEAR';
  dimension: 'domain' | 'subdomain' | 'email' | 'subject' | 'from_email' | 'to_email';
  action?: 'delete' | 'delete_1d' | 'delete_10d' | 'keep';  // Required for ADD/UPDATE
  keyValue: string;                    // The value being operated on
  parentDomain?: string;               // For subdomain/pattern operations
  parentSubdomain?: string;            // For subdomain pattern operations
  oldAction?: string;                  // For UPDATE: what action is being changed
}
```

### 6.3 Response Body Structure

```typescript
interface CriteriaModifyResponse {
  success: boolean;
  message: string;
  recordId?: number;                   // ID of created/modified record
  auditId?: number;                    // ID of audit log entry
  error?: string;                      // Error details if success=false
}
```

### 6.4 API to Stored Procedure Mapping

The API handler extracts `userEmail` from the session and passes all parameters to the stored procedure:

```typescript
// routes/criteria.ts
router.post('/modify', async (req: Request, res: Response) => {
  const userEmail = getUserEmail(req);  // From session
  const { operation, dimension, action, keyValue, parentDomain, parentSubdomain, oldAction } = req.body;

  // Call stored procedure
  const result = await query(`
    EXEC dbo.ModifyCriteria
      @Operation = @operation,
      @Dimension = @dimension,
      @Action = @action,
      @KeyValue = @keyValue,
      @UserEmail = @userEmail,
      @ParentDomain = @parentDomain,
      @ParentSubdomain = @parentSubdomain,
      @OldAction = @oldAction
  `, {
    operation,
    dimension,
    action: action || null,
    keyValue,
    userEmail,
    parentDomain: parentDomain || null,
    parentSubdomain: parentSubdomain || null,
    oldAction: oldAction || null
  });

  res.json({
    success: result.recordset[0].Success === 1,
    message: result.recordset[0].Message,
    recordId: result.recordset[0].RecordId,
    auditId: result.recordset[0].AuditId
  });
});
```

### 6.5 Example API Calls

#### Add Domain Delete Rule
```json
// Request
POST /api/criteria/modify
{
  "operation": "ADD",
  "dimension": "domain",
  "action": "delete",
  "keyValue": "spam.com"
}

// Response
{
  "success": true,
  "message": "Added delete rule for domain spam.com",
  "recordId": 142,
  "auditId": 1583
}
```

#### Add Subject Pattern to Subdomain
```json
// Request
POST /api/criteria/modify
{
  "operation": "ADD",
  "dimension": "subject",
  "action": "keep",
  "keyValue": "urgent",
  "parentDomain": "example.com",
  "parentSubdomain": "mail"
}

// Response
{
  "success": true,
  "message": "Added keep pattern 'urgent' for mail.example.com",
  "recordId": 89,
  "auditId": 1584
}
```

#### Update Domain Action
```json
// Request
POST /api/criteria/modify
{
  "operation": "UPDATE",
  "dimension": "domain",
  "action": "keep",
  "keyValue": "important.com",
  "oldAction": "delete"
}

// Response
{
  "success": true,
  "message": "Updated domain important.com from delete to keep",
  "recordId": 45,
  "auditId": 1585
}
```

#### Add FromEmail Keep Rule
```json
// Request
POST /api/criteria/modify
{
  "operation": "ADD",
  "dimension": "from_email",
  "action": "keep",
  "keyValue": "ceo@company.com",
  "parentDomain": "company.com"
}

// Response
{
  "success": true,
  "message": "Added keep rule for emails from ceo@company.com",
  "recordId": 23,
  "auditId": 1586
}
```

#### Remove Subdomain Rule
```json
// Request
POST /api/criteria/modify
{
  "operation": "REMOVE",
  "dimension": "subdomain",
  "keyValue": "promo",
  "parentDomain": "example.com"
}

// Response
{
  "success": true,
  "message": "Removed subdomain promo.example.com and 3 associated patterns",
  "recordId": null,
  "auditId": 1587
}
```

#### List Subdomains (GET operation)
```json
// Request
POST /api/criteria/modify
{
  "operation": "GET",
  "dimension": "subdomain",
  "keyValue": null,
  "parentDomain": "example.com"
}

// Response
{
  "success": true,
  "message": "Found 4 subdomains",
  "data": [
    { "subdomain": "mail", "action": "delete", "patternCount": 5 },
    { "subdomain": "support", "action": "keep", "patternCount": 2 },
    { "subdomain": "notify", "action": "delete_1d", "patternCount": 0 },
    { "subdomain": "archive", "action": "delete_10d", "patternCount": 1 }
  ]
}
```

### 6.6 Frontend Integration

```typescript
// hooks/useCriteria.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';

interface ModifyParams {
  operation: 'ADD' | 'REMOVE' | 'UPDATE' | 'CLEAR';
  dimension: 'domain' | 'subdomain' | 'email' | 'subject' | 'from_email' | 'to_email';
  action?: string;
  keyValue: string;
  parentDomain?: string;
  parentSubdomain?: string;
  oldAction?: string;
}

export function useModifyCriteria() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: ModifyParams) => {
      const response = await fetch('/api/criteria/modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      return response.json();
    },
    onSuccess: () => {
      // Invalidate all criteria-related queries
      queryClient.invalidateQueries({ queryKey: ['criteria'] });
      queryClient.invalidateQueries({ queryKey: ['emails'] });
    },
  });
}

// Usage in component
function DomainRow({ domain }: { domain: string }) {
  const modify = useModifyCriteria();

  const handleDelete = () => {
    modify.mutate({
      operation: 'ADD',
      dimension: 'domain',
      action: 'delete',
      keyValue: domain,
    });
  };

  const handleKeep = () => {
    modify.mutate({
      operation: 'ADD',
      dimension: 'domain',
      action: 'keep',
      keyValue: domain,
    });
  };

  // ...
}
```

### 6.7 Current API Endpoints (To Be Consolidated)

These existing endpoints will be consolidated into the single `/api/criteria/modify` endpoint:

| Current Endpoint | Method | Maps To |
|------------------|--------|---------|
| `/api/actions/add-criteria` | POST | `{operation: 'ADD', dimension: 'domain', action: 'delete'}` |
| `/api/actions/add-criteria-1d` | POST | `{operation: 'ADD', dimension: 'domain', action: 'delete_1d'}` |
| `/api/actions/add-criteria-10d` | POST | `{operation: 'ADD', dimension: 'domain', action: 'delete_10d'}` |
| `/api/actions/mark-keep` | POST | `{operation: 'ADD', dimension: 'domain', action: 'keep'}` |
| `/api/criteria/rule` | POST | `{operation: 'ADD', dimension: varies, action: varies}` |
| `/api/criteria/rule` | DELETE | `{operation: 'REMOVE', dimension: varies}` |
| `/api/criteria/domain/:domain` | PUT | `{operation: 'UPDATE', dimension: 'domain'}` |
| `/api/criteria/domain/:domain` | DELETE | `{operation: 'CLEAR', dimension: 'domain'}` |

---

## 7. Test Table Structure

### 7.1 Schema

```sql
CREATE TABLE criteria_test_cases (
    id INT IDENTITY(1,1) PRIMARY KEY,
    test_id NVARCHAR(10) NOT NULL,          -- D01, S01, E01, etc.
    category NVARCHAR(50) NOT NULL,          -- Domain, Subdomain, Email, etc.
    description NVARCHAR(255) NOT NULL,      -- Human-readable description

    -- Input parameters
    operation NVARCHAR(10) NOT NULL,         -- ADD, REMOVE, UPDATE, CLEAR
    dimension NVARCHAR(20) NOT NULL,         -- domain, subdomain, subject, etc.
    action NVARCHAR(20),                     -- delete, keep, etc.
    key_value NVARCHAR(255),                 -- The value being operated on
    parent_domain NVARCHAR(255),             -- Parent domain if applicable
    parent_subdomain NVARCHAR(255),          -- Parent subdomain if applicable
    old_action NVARCHAR(20),                 -- For UPDATE operations
    user_email NVARCHAR(255) DEFAULT 'test@user.com',

    -- Expected results
    expected_success BIT NOT NULL,
    expected_message NVARCHAR(255),
    expected_table NVARCHAR(50),             -- Which table should be affected

    -- Actual results (populated by test run)
    actual_success BIT,
    actual_message NVARCHAR(255),
    actual_record_id INT,

    -- Test status
    test_result NVARCHAR(10),                -- PASS, FAIL, ERROR
    test_run_at DATETIME,
    error_details NVARCHAR(MAX)
);
```

### 7.2 Sample Test Data Insert

```sql
-- Domain Operations
INSERT INTO criteria_test_cases (test_id, category, description, operation, dimension, action, key_value, expected_success, expected_table)
VALUES
    ('D01', 'Domain', 'Add domain delete rule', 'ADD', 'domain', 'delete', 'test-spam.com', 1, 'criteria'),
    ('D02', 'Domain', 'Add domain keep rule', 'ADD', 'domain', 'keep', 'test-important.com', 1, 'criteria'),
    ('D05', 'Domain', 'Remove domain rule', 'REMOVE', 'domain', NULL, 'test-spam.com', 1, 'criteria');

-- Subdomain Operations
INSERT INTO criteria_test_cases (test_id, category, description, operation, dimension, action, key_value, parent_domain, expected_success, expected_table)
VALUES
    ('S01', 'Subdomain', 'Add subdomain delete rule', 'ADD', 'subdomain', 'delete', 'mail', 'test-example.com', 1, 'criteria'),
    ('S02', 'Subdomain', 'Add subdomain keep rule', 'ADD', 'subdomain', 'keep', 'support', 'test-example.com', 1, 'criteria');

-- Subdomain Review Operations
INSERT INTO criteria_test_cases (test_id, category, description, operation, dimension, action, key_value, parent_domain, expected_success, expected_table)
VALUES
    ('SR01', 'Subdomain Review', 'List all subdomains for domain', 'GET', 'subdomain', NULL, NULL, 'test-example.com', 1, 'criteria'),
    ('SR02', 'Subdomain Review', 'View subdomain with patterns', 'GET', 'subdomain', NULL, 'mail', 'test-example.com', 1, 'criteria'),
    ('SR03', 'Subdomain Review', 'Edit subdomain default action', 'UPDATE', 'subdomain', 'delete_1d', 'mail', 'test-example.com', 1, 'criteria'),
    ('SR04', 'Subdomain Review', 'Delete subdomain from manager', 'REMOVE', 'subdomain', NULL, 'obsolete', 'test-example.com', 1, 'criteria');

-- Email Pattern Operations
INSERT INTO criteria_test_cases (test_id, category, description, operation, dimension, action, key_value, parent_domain, expected_success, expected_table)
VALUES
    ('E01', 'Email Pattern', 'Add fromEmail keep rule', 'ADD', 'from_email', 'keep', 'ceo@test-company.com', 'test-company.com', 1, 'email_patterns'),
    ('E02', 'Email Pattern', 'Add fromEmail delete rule', 'ADD', 'from_email', 'delete', 'spam@test-company.com', 'test-company.com', 1, 'email_patterns');
```

---

## 8. Testing Skill Design

### 8.1 Skill: `/test-criteria`

**Trigger phrases:** "test criteria", "run criteria tests", "run /test-criteria"

**Action:** Execute all criteria modification test cases without asking questions.

### 8.2 Workflow

```
1. Setup Phase
   ├── Clean up any existing test data (WHERE key_value LIKE 'test-%')
   ├── Reset test_result column to NULL
   └── Record start time

2. Execution Phase
   ├── For each test case:
   │   ├── Call ModifyCriteria with test parameters
   │   ├── Capture actual_success, actual_message, actual_record_id
   │   ├── Compare with expected values
   │   ├── Set test_result = 'PASS' or 'FAIL'
   │   └── Log any errors to error_details
   └── Handle transaction rollback on critical errors

3. Verification Phase
   ├── Verify audit_log entries exist for all modifying operations
   ├── Verify data integrity (foreign keys, constraints)
   └── Verify user isolation (cross-user queries return empty)

4. Report Phase
   ├── Count: Total, Passed, Failed, Errors
   ├── List all failed tests with details
   ├── Show execution time
   └── Clean up test data

5. Cleanup Phase
   ├── DELETE FROM criteria WHERE key_value LIKE 'test-%'
   ├── DELETE FROM patterns WHERE criteria_id NOT IN (SELECT id FROM criteria)
   ├── DELETE FROM email_patterns WHERE criteria_id NOT IN (SELECT id FROM criteria)
   └── DELETE FROM audit_log WHERE domain LIKE 'test-%'
```

### 8.3 Report Format

```
## Criteria Modification Test Report

### Summary
- Total Tests: 50
- Passed: 48 ✅
- Failed: 2 ❌
- Errors: 0

### Failed Tests
| ID | Description | Expected | Actual |
|----|-------------|----------|--------|
| X03 | Subject delete vs keep | keep | delete |
| U02 | User isolation | empty | 1 row |

### Execution Time: 2.3s

### Audit Log Entries: 42 created
```

---

## 9. Implementation Checklist

### Phase 1: Stored Procedure ✅ COMPLETE
- [x] Create `ModifyCriteria` stored procedure (`scripts/db/07-create-modify-criteria-procedure.sql`)
- [x] Implement ADD operation for all dimensions
- [x] Implement REMOVE operation for all dimensions
- [x] Implement UPDATE operation
- [x] Implement CLEAR operation
- [x] Add automatic audit logging
- [x] Add user_email filtering

### Phase 2: Test Infrastructure ✅ COMPLETE
- [x] Create `criteria_test_cases` table
- [x] Insert all 59 test cases (`scripts/db/08-create-criteria-tests.sql`)
- [x] Create test execution procedure (`RunCriteriaTests`)
- [x] All 59 tests passing

### Phase 3: API Integration ✅ COMPLETE
- [x] Add unified `/api/criteria/modify` endpoint (`server/routes/criteria.ts`)
- [x] Update `addRuleToSQL` to use stored procedure (`server/services/criteria.ts`)
- [x] Update `removeRuleFromSQL` to use stored procedure
- [x] Add `callModifyCriteria` helper function
- [x] Return stored procedure results to frontend

### Phase 4: Testing Skill ✅ COMPLETE
- [x] Implement `/test-criteria` skill in CLAUDE.md
- [x] Add cleanup logic (handles FK constraints)
- [x] Add report formatting

### Phase 5: Frontend Integration ✅ COMPLETE
- [x] Add `useModifyCriteria` hook (`src/hooks/useCriteria.ts`)
- [x] Existing hooks continue to work through backend integration

---

## 10. Database Tables Reference

### 10.1 criteria
```sql
CREATE TABLE criteria (
    id INT IDENTITY(1,1) PRIMARY KEY,
    key_value NVARCHAR(255) NOT NULL,        -- domain, subdomain, or email
    key_type NVARCHAR(20) NOT NULL,          -- 'domain', 'subdomain', 'email'
    default_action NVARCHAR(20),             -- 'delete', 'delete_1d', 'delete_10d', 'keep', NULL
    parent_id INT NULL REFERENCES criteria(id),
    user_email NVARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT GETDATE(),
    updated_at DATETIME DEFAULT GETDATE()
);
```

### 10.2 patterns
```sql
CREATE TABLE patterns (
    id INT IDENTITY(1,1) PRIMARY KEY,
    criteria_id INT NOT NULL REFERENCES criteria(id),
    action NVARCHAR(20) NOT NULL,            -- 'keep', 'delete', 'delete_1d', 'delete_10d'
    pattern NVARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT GETDATE()
);
```

### 10.3 email_patterns
```sql
CREATE TABLE email_patterns (
    id INT IDENTITY(1,1) PRIMARY KEY,
    criteria_id INT NOT NULL REFERENCES criteria(id),
    direction NVARCHAR(10) NOT NULL,         -- 'from', 'to'
    action NVARCHAR(20) NOT NULL,            -- 'keep', 'delete'
    email NVARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT GETDATE()
);
```

### 10.4 audit_log
```sql
CREATE TABLE audit_log (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_email NVARCHAR(255) NOT NULL,
    action_type NVARCHAR(10) NOT NULL,       -- 'INSERT', 'UPDATE', 'DELETE'
    table_name NVARCHAR(50) NOT NULL,
    record_id INT,
    domain NVARCHAR(255),
    details NVARCHAR(MAX),                   -- JSON
    created_at DATETIME DEFAULT GETDATE()
);
```

---

## 11. Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-04 | Initial comprehensive design document |
| 1.1 | 2026-01-05 | Implementation complete - all phases done, 59 tests passing |

---

## 12. Files Reference

| File | Description |
|------|-------------|
| `scripts/db/07-create-modify-criteria-procedure.sql` | ModifyCriteria stored procedure |
| `scripts/db/08-create-criteria-tests.sql` | Test table and 59 test cases |
| `server/routes/criteria.ts` | Unified `/api/criteria/modify` endpoint |
| `server/services/criteria.ts` | `callModifyCriteria`, `addRuleToSQL`, `removeRuleFromSQL` |
| `src/hooks/useCriteria.ts` | `useModifyCriteria` frontend hook |
| `CLAUDE.md` | `/test-criteria` skill definition |

---

*Document generated for Gmail Dashboard criteria modification system redesign.*
