# ADR-003: AddCriteriaRule Stored Procedure Workflow

**Status:** Proposed
**Date:** 2026-01-07
**Decision Makers:** Developer
**Supersedes:** None
**Related:** ADR-001 (Email Evaluation Flow), ADR-002 (Multi-User Auth)

---

## Context

### Problem Statement

The Gmail Dashboard allows users to create rules (keep/delete) for emails based on:
- Domain level (e.g., `icicibank.com`)
- Subdomain level (e.g., `custcomm.icicibank.com`)
- Exact FROM email address (e.g., `noreply@custcomm.icicibank.com`)
- TO email address (e.g., rules based on recipient)
- Subject patterns (e.g., "Webinar")

### What Triggered This Decision

1. User added 3 delete criteria for `custcomm.icicibank.com`:
   - "Beware of online"
   - "Update for"
   - "Webinar"

2. After evaluation, only 1 email showed up for deletion instead of 3

3. Investigation revealed:
   - `custcomm.icicibank.com` was stored with `key_type='domain'` instead of `key_type='subdomain'`
   - No `parent_id` linking to parent domain `icicibank.com`
   - Evaluation stored procedure couldn't find matching patterns because it expected `key_type='subdomain'` with `parent_id`

4. **Root cause:** TypeScript code was making business logic decisions about what type of entry to create:
   ```typescript
   // BAD - TypeScript deciding what to pass
   const dimension = domainLower.includes('@') ? 'email' : 'domain';
   await callModifyCriteria('ADD', dimension, ...);
   ```

5. This is the **hundredth time** this type of bug has occurred because business logic is split between TypeScript and SQL

---

## Decision

**All business logic for criteria management will be centralized in a single stored procedure: `AddCriteriaRule`.**

TypeScript becomes a **dumb pass-through** that sends ALL available email fields plus user intent. TypeScript does NOT extract, compute, or decide anything about the data.

---

## Detailed Design

### Principle: TypeScript = Dumb Pipe

**TypeScript ONLY passes:**
1. Raw email fields exactly as received (no extraction, no parsing)
2. User intent (what button they clicked)
3. User context (authenticated user email)

**TypeScript does NOT:**
- Extract domain from email address
- Determine if something is a subdomain vs domain
- Decide `key_type`
- Compute `parent_id`
- Parse email addresses
- Make ANY business logic decisions

### Input Contract

Every call to the stored procedure includes ALL available email fields:

```typescript
interface AddCriteriaRequest {
  // ═══════════════════════════════════════════════════════════════════
  // RAW EMAIL FIELDS - Always pass ALL fields, never extract/compute
  // ═══════════════════════════════════════════════════════════════════
  fromEmail: string;      // e.g., 'noreply@custcomm.icicibank.com'
  toEmail: string;        // e.g., 'prakash.heda@gmail.com'
  subject: string;        // e.g., 'Webinar on Real Estate Trends'

  // ═══════════════════════════════════════════════════════════════════
  // USER INTENT - What the user selected in the UI
  // ═══════════════════════════════════════════════════════════════════
  action: 'keep' | 'delete' | 'delete_1d' | 'delete_10d';
  level: 'domain' | 'subdomain' | 'from_email' | 'to_email';
  subjectPattern?: string; // Optional - if user highlighted text

  // ═══════════════════════════════════════════════════════════════════
  // CONTEXT
  // ═══════════════════════════════════════════════════════════════════
  userEmail: string;      // Authenticated user
}
```

### Stored Procedure Signature

```sql
CREATE PROCEDURE dbo.AddCriteriaRule
    -- Raw email fields (always passed)
    @FromEmail NVARCHAR(255),
    @ToEmail NVARCHAR(255),
    @Subject NVARCHAR(500),

    -- User intent
    @Action NVARCHAR(20),           -- keep, delete, delete_1d, delete_10d
    @Level NVARCHAR(20),            -- domain, subdomain, from_email, to_email
    @SubjectPattern NVARCHAR(500) = NULL,

    -- Context
    @UserEmail NVARCHAR(255)
AS
BEGIN
    -- ALL business logic happens here
END
```

---

## Stored Procedure Workflow

### Step 1: Parse Email Address

Extract domain components from `@FromEmail`:

```sql
-- Input: 'noreply@custcomm.icicibank.com'
-- Output:
--   @FullDomain = 'custcomm.icicibank.com'
--   @PrimaryDomain = 'icicibank.com'
--   @HasSubdomain = 1 (true)

DECLARE @AtPos INT = CHARINDEX('@', @FromEmail);
DECLARE @FullDomain NVARCHAR(255) = LOWER(SUBSTRING(@FromEmail, @AtPos + 1, LEN(@FromEmail)));

-- Extract primary domain (last 2 parts)
-- Split by dots and take last 2 segments
DECLARE @DotCount INT = LEN(@FullDomain) - LEN(REPLACE(@FullDomain, '.', ''));
DECLARE @PrimaryDomain NVARCHAR(255);
DECLARE @HasSubdomain BIT = 0;

IF @DotCount >= 2
BEGIN
    -- Has subdomain: custcomm.icicibank.com -> icicibank.com
    -- Find position of second-to-last dot
    DECLARE @LastDot INT = LEN(@FullDomain) - CHARINDEX('.', REVERSE(@FullDomain)) + 1;
    DECLARE @SecondLastDot INT = LEN(@FullDomain) - CHARINDEX('.', REVERSE(@FullDomain), LEN(@FullDomain) - @LastDot + 2) + 1;
    SET @PrimaryDomain = SUBSTRING(@FullDomain, @SecondLastDot + 1, LEN(@FullDomain));
    SET @HasSubdomain = 1;
END
ELSE
BEGIN
    -- No subdomain: icicibank.com stays as icicibank.com
    SET @PrimaryDomain = @FullDomain;
    SET @HasSubdomain = 0;
END
```

### Step 2: Route Based on @Level

```sql
-- Route to appropriate handler based on user's selection
IF @Level = 'domain'
BEGIN
    -- User clicked on domain grouping (e.g., icicibank.com)
    EXEC @Result = dbo.HandleDomainLevel @PrimaryDomain, @Action, @SubjectPattern, @UserEmail;
END
ELSE IF @Level = 'subdomain'
BEGIN
    -- User clicked on subdomain grouping (e.g., custcomm.icicibank.com)
    EXEC @Result = dbo.HandleSubdomainLevel @FullDomain, @PrimaryDomain, @Action, @SubjectPattern, @UserEmail;
END
ELSE IF @Level = 'from_email'
BEGIN
    -- User clicked on exact sender email
    EXEC @Result = dbo.HandleFromEmailLevel @FromEmail, @Action, @UserEmail;
END
ELSE IF @Level = 'to_email'
BEGIN
    -- User wants to create rule based on recipient
    EXEC @Result = dbo.HandleToEmailLevel @ToEmail, @Action, @UserEmail;
END
```

### Step 3A: Handle Domain Level (`@Level = 'domain'`)

**User wants rule applied to entire domain (including all subdomains)**

```
+-------------------------------------------------------------------------+
| INPUT                                                                   |
|   fromEmail = 'noreply@custcomm.icicibank.com'                         |
|   level = 'domain'                                                      |
|   action = 'keep'                                                       |
|   subjectPattern = NULL                                                 |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| STEP 1: Use @PrimaryDomain = 'icicibank.com'                           |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| STEP 2: Find or create criteria entry                                   |
|                                                                         |
|   SELECT @CriteriaId = id FROM criteria                                |
|   WHERE key_value = 'icicibank.com'                                    |
|     AND key_type = 'domain'                                            |
|     AND user_email = @UserEmail                                        |
|                                                                         |
|   IF @CriteriaId IS NULL                                               |
|   BEGIN                                                                 |
|       INSERT INTO criteria (key_value, key_type, parent_id, user_email)|
|       VALUES ('icicibank.com', 'domain', NULL, @UserEmail)             |
|       SET @CriteriaId = SCOPE_IDENTITY()                               |
|   END                                                                   |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| STEP 3: Handle pattern or default action                                |
|                                                                         |
|   IF @SubjectPattern IS NOT NULL                                       |
|   BEGIN                                                                 |
|       -- Add subject pattern                                           |
|       INSERT INTO patterns (criteria_id, pattern, action)              |
|       VALUES (@CriteriaId, @SubjectPattern, @Action)                   |
|   END                                                                   |
|   ELSE                                                                  |
|   BEGIN                                                                 |
|       -- Set default action for entire domain                          |
|       UPDATE criteria SET default_action = @Action                     |
|       WHERE id = @CriteriaId                                           |
|   END                                                                   |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| RESULT                                                                  |
|   ALL emails from icicibank.com AND all subdomains are affected        |
|   (custcomm.icicibank.com, mail.icicibank.com, etc.)                   |
+-------------------------------------------------------------------------+
```

### Step 3B: Handle Subdomain Level (`@Level = 'subdomain'`)

**User wants rule applied only to specific subdomain**

```
+-------------------------------------------------------------------------+
| INPUT                                                                   |
|   fromEmail = 'noreply@custcomm.icicibank.com'                         |
|   level = 'subdomain'                                                   |
|   action = 'delete'                                                     |
|   subjectPattern = 'Webinar'                                           |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| STEP 1: Parse domains                                                   |
|   @FullDomain = 'custcomm.icicibank.com'                               |
|   @PrimaryDomain = 'icicibank.com'                                     |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| STEP 2: FIRST ensure parent domain entry exists                         |
|                                                                         |
|   SELECT @ParentId = id FROM criteria                                  |
|   WHERE key_value = 'icicibank.com'                                    |
|     AND key_type = 'domain'                                            |
|     AND user_email = @UserEmail                                        |
|                                                                         |
|   IF @ParentId IS NULL                                                 |
|   BEGIN                                                                 |
|       INSERT INTO criteria (key_value, key_type, parent_id, user_email)|
|       VALUES ('icicibank.com', 'domain', NULL, @UserEmail)             |
|       SET @ParentId = SCOPE_IDENTITY()                                 |
|   END                                                                   |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| STEP 3: THEN find or create subdomain entry WITH parent link            |
|                                                                         |
|   SELECT @SubdomainId = id FROM criteria                               |
|   WHERE key_value = 'custcomm.icicibank.com'                           |
|     AND key_type = 'subdomain'          <-- CRITICAL: must be 'subdomain'
|     AND parent_id = @ParentId           <-- CRITICAL: must link to parent
|     AND user_email = @UserEmail                                        |
|                                                                         |
|   IF @SubdomainId IS NULL                                              |
|   BEGIN                                                                 |
|       INSERT INTO criteria (key_value, key_type, parent_id, user_email)|
|       VALUES ('custcomm.icicibank.com', 'subdomain', @ParentId, @UserEmail)
|       SET @SubdomainId = SCOPE_IDENTITY()                              |
|   END                                                                   |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| STEP 4: Add pattern to subdomain entry                                  |
|                                                                         |
|   IF @SubjectPattern IS NOT NULL                                       |
|   BEGIN                                                                 |
|       INSERT INTO patterns (criteria_id, pattern, action)              |
|       VALUES (@SubdomainId, 'Webinar', 'delete')                       |
|   END                                                                   |
|   ELSE                                                                  |
|   BEGIN                                                                 |
|       UPDATE criteria SET default_action = @Action                     |
|       WHERE id = @SubdomainId                                          |
|   END                                                                   |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| RESULT                                                                  |
|   Only emails from custcomm.icicibank.com with "Webinar" are deleted   |
|   Other icicibank.com subdomains are NOT affected                      |
|   Other custcomm.icicibank.com subjects are NOT affected               |
+-------------------------------------------------------------------------+
```

### Step 3C: Handle FROM Email Level (`@Level = 'from_email'`)

**User wants rule for exact sender email address**

```
+-------------------------------------------------------------------------+
| INPUT                                                                   |
|   fromEmail = 'ceo@company.com'                                        |
|   level = 'from_email'                                                  |
|   action = 'keep'                                                       |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| STEP 1: Use full @FromEmail = 'ceo@company.com'                        |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| STEP 2: Find or create criteria entry                                   |
|                                                                         |
|   SELECT @CriteriaId = id FROM criteria                                |
|   WHERE key_value = 'ceo@company.com'                                  |
|     AND key_type = 'email'              <-- Note: 'email' not 'domain' |
|     AND user_email = @UserEmail                                        |
|                                                                         |
|   IF @CriteriaId IS NULL                                               |
|   BEGIN                                                                 |
|       INSERT INTO criteria (key_value, key_type, parent_id, user_email)|
|       VALUES ('ceo@company.com', 'email', NULL, @UserEmail)            |
|       SET @CriteriaId = SCOPE_IDENTITY()                               |
|   END                                                                   |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| STEP 3: Set default action                                              |
|                                                                         |
|   UPDATE criteria SET default_action = 'keep'                          |
|   WHERE id = @CriteriaId                                               |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| RESULT                                                                  |
|   Only emails from exactly 'ceo@company.com' are kept                  |
|   Emails from other @company.com addresses are NOT affected            |
+-------------------------------------------------------------------------+
```

### Step 3D: Handle TO Email Level (`@Level = 'to_email'`)

**User wants rule based on recipient address**

```
+-------------------------------------------------------------------------+
| INPUT                                                                   |
|   fromEmail = 'newsletter@shop.com'     (not used)                     |
|   toEmail = 'myoldaddress@gmail.com'                                   |
|   level = 'to_email'                                                    |
|   action = 'delete'                                                     |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| STEP 1: Parse @ToEmail to get domain                                    |
|   @ToDomain = 'gmail.com'                                              |
|   @ToEmailFull = 'myoldaddress@gmail.com'                              |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| STEP 2: Find or create domain criteria (for organization)              |
|                                                                         |
|   SELECT @DomainId = id FROM criteria                                  |
|   WHERE key_value = 'gmail.com'                                        |
|     AND key_type = 'domain'                                            |
|     AND user_email = @UserEmail                                        |
|                                                                         |
|   IF @DomainId IS NULL                                                 |
|   BEGIN                                                                 |
|       INSERT INTO criteria (key_value, key_type, user_email)           |
|       VALUES ('gmail.com', 'domain', @UserEmail)                       |
|       SET @DomainId = SCOPE_IDENTITY()                                 |
|   END                                                                   |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| STEP 3: Add to email_patterns table                                     |
|                                                                         |
|   INSERT INTO email_patterns (criteria_id, email, direction, action)   |
|   VALUES (@DomainId, 'myoldaddress@gmail.com', 'to', 'delete')         |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| RESULT                                                                  |
|   ALL emails sent TO 'myoldaddress@gmail.com' are deleted              |
|   Regardless of who sent them                                          |
+-------------------------------------------------------------------------+
```

---

## Complete Scenarios with Database State

### Scenario 1: Keep All from Subdomain (No Pattern)

**UI Action:** User views email from `noreply@custcomm.icicibank.com`, clicks subdomain grouping, clicks "Keep All"

**TypeScript sends:**
```typescript
{
  fromEmail: 'noreply@custcomm.icicibank.com',
  toEmail: 'prakash.heda@gmail.com',
  subject: 'Webinar on Real Estate',
  action: 'keep',
  level: 'subdomain',
  subjectPattern: null,
  userEmail: 'prakash.heda@gmail.com'
}
```

**Database state BEFORE:**
```
criteria: (empty or no matching entries)
patterns: (empty)
```

**Database state AFTER:**
```
criteria:
| id  | key_value                  | key_type  | parent_id | default_action | user_email             |
|-----|----------------------------|-----------|-----------|----------------|------------------------|
| 100 | icicibank.com              | domain    | NULL      | NULL           | prakash.heda@gmail.com |
| 101 | custcomm.icicibank.com     | subdomain | 100       | keep           | prakash.heda@gmail.com |

patterns: (empty - no subject pattern)
```

---

### Scenario 2: Delete Pattern from Subdomain

**UI Action:** User views email with subject "Webinar on Real Estate", clicks subdomain grouping, selects "Webinar" text, clicks "Delete"

**TypeScript sends:**
```typescript
{
  fromEmail: 'noreply@custcomm.icicibank.com',
  toEmail: 'prakash.heda@gmail.com',
  subject: 'Webinar on Real Estate Trends and Opportunities',
  action: 'delete',
  level: 'subdomain',
  subjectPattern: 'Webinar',
  userEmail: 'prakash.heda@gmail.com'
}
```

**Database state AFTER:**
```
criteria:
| id  | key_value                  | key_type  | parent_id | default_action | user_email             |
|-----|----------------------------|-----------|-----------|----------------|------------------------|
| 100 | icicibank.com              | domain    | NULL      | NULL           | prakash.heda@gmail.com |
| 101 | custcomm.icicibank.com     | subdomain | 100       | NULL           | prakash.heda@gmail.com |

patterns:
| id | criteria_id | pattern  | action |
|----|-------------|----------|--------|
| 1  | 101         | Webinar  | delete |
```

---

### Scenario 3: Delete All from Domain (Affects All Subdomains)

**UI Action:** User clicks domain grouping (icicibank.com), clicks "Delete All"

**TypeScript sends:**
```typescript
{
  fromEmail: 'noreply@custcomm.icicibank.com',
  toEmail: 'prakash.heda@gmail.com',
  subject: 'Some email',
  action: 'delete',
  level: 'domain',
  subjectPattern: null,
  userEmail: 'prakash.heda@gmail.com'
}
```

**Database state AFTER:**
```
criteria:
| id  | key_value                  | key_type  | parent_id | default_action | user_email             |
|-----|----------------------------|-----------|-----------|----------------|------------------------|
| 100 | icicibank.com              | domain    | NULL      | delete         | prakash.heda@gmail.com |
```

**Effect:** ALL emails from icicibank.com AND all subdomains are deleted (custcomm.icicibank.com, mail.icicibank.com, etc.)

---

### Scenario 4: Keep Exact Sender

**UI Action:** User clicks exact email address, clicks "Keep"

**TypeScript sends:**
```typescript
{
  fromEmail: 'ceo@company.com',
  toEmail: 'prakash.heda@gmail.com',
  subject: 'Important Update',
  action: 'keep',
  level: 'from_email',
  subjectPattern: null,
  userEmail: 'prakash.heda@gmail.com'
}
```

**Database state AFTER:**
```
criteria:
| id  | key_value       | key_type | parent_id | default_action | user_email             |
|-----|-----------------|----------|-----------|----------------|------------------------|
| 200 | ceo@company.com | email    | NULL      | keep           | prakash.heda@gmail.com |
```

---

### Scenario 5: Delete by Recipient

**UI Action:** User creates rule to delete all emails sent to their old address

**TypeScript sends:**
```typescript
{
  fromEmail: 'newsletter@shop.com',
  toEmail: 'myoldaddress@gmail.com',
  subject: 'Sale!',
  action: 'delete',
  level: 'to_email',
  subjectPattern: null,
  userEmail: 'prakash.heda@gmail.com'
}
```

**Database state AFTER:**
```
criteria:
| id  | key_value  | key_type | parent_id | default_action | user_email             |
|-----|------------|----------|-----------|----------------|------------------------|
| 300 | gmail.com  | domain   | NULL      | NULL           | prakash.heda@gmail.com |

email_patterns:
| id | criteria_id | email                    | direction | action |
|----|-------------|--------------------------|-----------|--------|
| 1  | 300         | myoldaddress@gmail.com   | to        | delete |
```

---

## Why This Design

### The Core Problem We're Solving

**Before (Business Logic Split):**
```
+-------------------------------------------------------------+
| TypeScript                                                  |
|                                                             |
| - Extracts domain from email                                |
| - Decides if it's subdomain vs domain                       |
| - Determines key_type                                       |
| - Passes computed values to SQL                             |
|                                                             |
| BUG: custcomm.icicibank.com passed as 'domain' not          |
|      'subdomain', no parent_id set                          |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| SQL Stored Procedure                                        |
|                                                             |
| - Trusts TypeScript's classification                        |
| - Just inserts what it receives                             |
| - Evaluation fails because data is wrong                    |
+-------------------------------------------------------------+
```

**After (Business Logic Centralized):**
```
+-------------------------------------------------------------+
| TypeScript (Dumb Pipe)                                      |
|                                                             |
| - Passes raw fromEmail: 'noreply@custcomm.icicibank.com'    |
| - Passes raw toEmail: 'prakash.heda@gmail.com'              |
| - Passes raw subject                                        |
| - Passes user intent: level='subdomain', action='delete'    |
|                                                             |
| NO extraction, NO classification, NO decisions              |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| SQL Stored Procedure (All Business Logic)                   |
|                                                             |
| 1. Parses email -> extracts domain parts                    |
| 2. Determines: this is a subdomain of icicibank.com         |
| 3. Creates parent entry first (key_type='domain')           |
| 4. Creates subdomain entry (key_type='subdomain',           |
|    parent_id linked correctly)                              |
| 5. Adds pattern if provided                                 |
|                                                             |
| Same logic used for both ADD and EVALUATE                   |
+-------------------------------------------------------------+
```

### Benefits

1. **Single source of truth:** Domain parsing happens in ONE place
2. **Consistent behavior:** ADD and EVALUATE use same logic
3. **Easier debugging:** When rules don't work, check stored procedure only
4. **No version mismatch:** Can't have TypeScript and SQL disagree on classification
5. **Testable:** All scenarios can be tested in SQL alone

---

## Implementation Plan

### Phase 1: Create New Stored Procedure

**File:** `scripts/db/10-create-add-criteria-procedure.sql`

Contents:
1. Domain parsing helper function
2. `AddCriteriaRule` stored procedure with full workflow
3. Return codes for success/failure

### Phase 2: Simplify TypeScript

**File:** `server/services/criteria.ts`

Remove:
- Domain extraction logic
- `key_type` decisions
- `parent_id` computation
- All business logic

Keep only:
```typescript
async function addCriteriaRule(
  fromEmail: string,
  toEmail: string,
  subject: string,
  action: Action,
  level: Level,
  userEmail: string,
  subjectPattern?: string
): Promise<void> {
  await query(
    `EXEC dbo.AddCriteriaRule
      @FromEmail = @fromEmail,
      @ToEmail = @toEmail,
      @Subject = @subject,
      @Action = @action,
      @Level = @level,
      @SubjectPattern = @subjectPattern,
      @UserEmail = @userEmail`,
    { fromEmail, toEmail, subject, action, level, subjectPattern, userEmail }
  );
}
```

**File:** `server/routes/actions.ts`

Change from:
```typescript
const { domain, subject_pattern } = req.body;
await addRuleAsync(domain, 'delete', userEmail, subject_pattern);
```

To:
```typescript
const { fromEmail, toEmail, subject, level, subjectPattern } = req.body;
await addCriteriaRule(fromEmail, toEmail, subject, 'delete', level, userEmail, subjectPattern);
```

### Phase 3: Update UI

**Files:** `src/pages/Review.tsx`, related components

Ensure buttons send:
- `fromEmail`: raw email from the email record
- `toEmail`: raw email from the email record
- `subject`: raw subject from the email record
- `level`: based on current grouping view ('domain' | 'subdomain')
- `subjectPattern`: if user selected text

### Phase 4: Testing

**File:** `scripts/db/11-add-criteria-tests.sql`

Test cases:
1. Domain level - keep (no pattern)
2. Domain level - delete with pattern
3. Subdomain level - keep (no pattern)
4. Subdomain level - delete with pattern
5. FROM email level - keep
6. TO email level - delete
7. Multiple patterns on same subdomain
8. Subdomain created after parent already exists
9. Verify parent_id is set correctly
10. Verify key_type is set correctly

---

## Consequences

### Positive

1. **No more classification bugs:** TypeScript can't misclassify domains
2. **Single point of change:** To fix logic, only change SQL
3. **Consistent data:** Parent-child relationships always correct
4. **Testable in isolation:** SQL tests cover all business logic
5. **Simpler TypeScript:** Easier to maintain

### Negative

1. **More complex SQL:** Stored procedure has more logic
2. **T-SQL string parsing:** Need robust email parsing in SQL
3. **Migration effort:** Existing code needs refactoring

### Risks

1. **SQL parsing edge cases:** Unusual email formats may fail
2. **Performance:** String parsing in SQL could be slower (negligible for this use case)
3. **Existing data:** May need to fix existing criteria entries with wrong key_type/parent_id

---

## Files to Modify

| File | Change |
|------|--------|
| `scripts/db/10-create-add-criteria-procedure.sql` | New - stored procedure |
| `scripts/db/11-add-criteria-tests.sql` | New - test cases |
| `server/services/criteria.ts` | Remove business logic, simplify to pass-through |
| `server/routes/actions.ts` | Pass raw fields instead of extracted domain |
| `src/pages/Review.tsx` | Send level based on current grouping |
| `docs/adr/ADR-003-add-criteria-rule-workflow.md` | This document |

---

## References

- ADR-001: Email Evaluation Flow
- ADR-002: Multi-User Authentication
- Related bug: custcomm.icicibank.com stored with key_type='domain' instead of 'subdomain'
