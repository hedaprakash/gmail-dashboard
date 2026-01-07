# ADR-002: Multi-User Authentication and Testing Strategy

**Status:** Proposed
**Date:** 2026-01-06
**Decision Makers:** Developer
**Supersedes:** None
**Related:** ADR-001 (Email Evaluation Flow)

---

## Context

### Problem Statement

The Gmail Dashboard currently has a hybrid authentication system:
- **Browser users**: OAuth flow works correctly (Sign in with Google → session cookie)
- **API/CLI testing**: Cannot test without a browser session
- **Multi-user isolation**: Implemented in database, but not tested

The user asked: *"Hundreds of users will go to the home page, click authenticate - how do real-world apps implement this? How do developers test multiple users logging in and seeing their own data, not each other's?"*

### What Triggered This Decision

1. After refreshing emails from Gmail, the Execute page showed nothing for deletion
2. Clicking "Re-evaluate Emails" didn't work (stored procedure was missing)
3. When trying to test the fix via API, authentication failed (401)
4. Falling back to Python scripts was criticized as "taking the easy route"
5. Need to properly document and test the authentication architecture

---

## Decision

Implement a **dual authentication strategy** with comprehensive multi-user testing:

1. **Browser Authentication**: OAuth flow (existing, mostly working)
2. **API Authentication**: API key for CLI/testing
3. **Token Storage**: Database per-user instead of single file
4. **Testing Strategy**: Playwright context isolation with multiple test users

---

## How We Made This Decision

### Step 1: Analyzed Current Architecture

**What's Working:**
- OAuth flow via browser (Sign in with Google)
- Session cookie authentication (`express-session`)
- Gmail API calls with access token
- Multi-user data scoping via `user_email` column

**What's Broken:**
- All tokens stored in single `token.json` file (not per-user)
- No way to test APIs without browser session
- E2E tests failing with 401 (session required)
- No tests for multi-user isolation

### Step 2: Researched Production Best Practices

**Sources Consulted:**
- [Microsoft Identity Platform Testing](https://learn.microsoft.com/en-us/entra/identity-platform/test-automate-integration-testing)
- [Playwright Multi-User Testing](https://playwright.dev/docs/auth)
- [Multi-User Test Runner (Java)](https://vincit.github.io/multi-user-test-runner/)
- [Playwright Browser Context Isolation](https://playwright.dev/docs/browser-contexts)

**Key Findings:**

| Practice | How Production Apps Do It |
|----------|---------------------------|
| Token Storage | Database (encrypted), not files |
| Per-User Tokens | One refresh token per user row |
| Token Refresh | Background worker auto-refreshes before expiry |
| Session Storage | Redis-backed (scalable), not memory |
| Multi-Device | Each device gets its own session |
| Test Users | Dedicated test accounts with MFA exemptions |
| Multi-User Tests | Playwright browser context isolation |

### Step 3: Evaluated Options

#### Option A: Skip Auth for Tests (Rejected)
```typescript
if (process.env.NODE_ENV === 'test') return next();
```
- **Pros**: Simple, fast
- **Cons**: Doesn't test real auth flow, security risk if misconfigured

#### Option B: API Key for Testing (Selected)
```typescript
if (req.headers['x-api-key'] === process.env.API_KEY) return next();
```
- **Pros**: Secure, explicit, works for CLI/automation
- **Cons**: Extra auth path to maintain

#### Option C: Mock OAuth Provider (Considered for Future)
- Use tools like `oauth2-mock-server` for full OAuth testing
- **Pros**: Tests complete flow
- **Cons**: Complex setup, overkill for current needs

### Step 4: Designed Testing Strategy

Based on [Playwright's multi-user patterns](https://playwright.dev/docs/auth) and [medium.com article on fixture isolation](https://medium.com/@edtang44/isolate-and-conquer-multi-user-testing-with-playwright-fixtures-f211ad438974):

**Key Principle**: Each test user operates in an isolated browser context with its own:
- Cookies
- Local storage
- Session storage
- Network state

---

## Production OAuth Architecture

### The Standard Flow (What Users Experience)

```
User visits homepage
    ↓
Clicks "Sign in with Google"
    ↓
Google consent screen (user approves)
    ↓
Google returns authorization code to backend
    ↓
Backend exchanges code for:
  - Access token (short-lived: 5-15 min)
  - Refresh token (long-lived, stored in DB)
    ↓
Backend creates session, sends cookie to browser
    ↓
User is now authenticated
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    React Frontend                        │
│              "Sign in with Google" Button               │
└──────────────────┬──────────────────────────────────────┘
                   │ Auth code
                   ▼
┌─────────────────────────────────────────────────────────┐
│                  Express Backend                         │
│                                                         │
│  1. Exchange auth code for tokens                       │
│  2. Store refresh token ENCRYPTED in database           │
│  3. Cache access token (Redis or memory)                │
│  4. Create session, send cookie to browser              │
└──────────────────┬──────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
   ┌─────────────┐      ┌──────────────┐
   │   SQL DB    │      │    Cache     │
   │             │      │              │
   │ - Refresh   │      │ - Access     │
   │   tokens    │      │   tokens     │
   │ - User data │      │ - Sessions   │
   └─────────────┘      └──────────────┘
```

### Current vs Production Comparison

| Aspect | Current | Production Best Practice |
|--------|---------|-------------------------|
| Token storage | File (`token.json`) | Database (encrypted) |
| Per-user tokens | Single file for all | One refresh token per user in DB |
| Token refresh | Manual | Background worker auto-refreshes |
| Session | Memory-based | Redis-backed (scalable) |
| Multi-device | Not supported | Each device gets session |
| API testing | Not supported | API key authentication |

---

## Multi-User Testing Strategy

### How Real-World Apps Test Multi-User Isolation

Based on industry research, there are 4 main testing levels:

### Level 1: Database Isolation Tests (SQL)

Test that queries are properly scoped:

```sql
-- Test: User A cannot see User B's emails
INSERT INTO pending_emails (GmailId, user_email, Subject)
VALUES ('email1', 'user-a@test.com', 'User A Email');

INSERT INTO pending_emails (GmailId, user_email, Subject)
VALUES ('email2', 'user-b@test.com', 'User B Email');

-- Query as User A should return only 1 row
SELECT COUNT(*) as cnt FROM pending_emails WHERE user_email = 'user-a@test.com';
-- Expected: 1

-- Stored procedure should only evaluate User A's emails
EXEC dbo.EvaluatePendingEmails @UserEmail = 'user-a@test.com';

-- Verify User B's emails were not touched
SELECT Action FROM pending_emails WHERE user_email = 'user-b@test.com';
-- Expected: NULL (not evaluated)
```

### Level 2: API Integration Tests (Playwright/Jest)

Test that API routes respect user context:

```typescript
// tests/multi-user.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Multi-User Isolation', () => {
  const API_KEY = process.env.API_KEY;

  test.beforeAll(async () => {
    // Setup: Insert test data for two users
    await execSql(`
      DELETE FROM pending_emails WHERE user_email LIKE '%@test.com';
      INSERT INTO pending_emails (GmailId, user_email, FromEmail, Subject, PrimaryDomain)
      VALUES
        ('test-a-1', 'user-a@test.com', 'sender@example.com', 'User A Email 1', 'example.com'),
        ('test-a-2', 'user-a@test.com', 'sender@example.com', 'User A Email 2', 'example.com'),
        ('test-b-1', 'user-b@test.com', 'sender@other.com', 'User B Email', 'other.com');
    `);
  });

  test('User A sees only their emails', async ({ request }) => {
    // Authenticate as User A (via API key + user context)
    const response = await request.get('/api/execute/summary', {
      headers: {
        'X-API-Key': API_KEY,
        'X-Test-User': 'user-a@test.com'  // Test-only header
      }
    });

    const json = await response.json();
    expect(json.total).toBe(2);  // User A has 2 emails
  });

  test('User B sees only their emails', async ({ request }) => {
    const response = await request.get('/api/execute/summary', {
      headers: {
        'X-API-Key': API_KEY,
        'X-Test-User': 'user-b@test.com'
      }
    });

    const json = await response.json();
    expect(json.total).toBe(1);  // User B has 1 email
  });

  test('User A actions do not affect User B', async ({ request }) => {
    // User A adds a delete rule
    await request.post('/api/actions/add-criteria', {
      headers: { 'X-API-Key': API_KEY, 'X-Test-User': 'user-a@test.com' },
      data: { primaryDomain: 'example.com', action: 'delete' }
    });

    // Re-evaluate as User A
    await request.post('/api/execute/evaluate', {
      headers: { 'X-API-Key': API_KEY, 'X-Test-User': 'user-a@test.com' }
    });

    // User B's email should still be undecided
    const response = await request.get('/api/execute/summary', {
      headers: { 'X-API-Key': API_KEY, 'X-Test-User': 'user-b@test.com' }
    });

    const json = await response.json();
    const undecided = json.byAction.find(a => a.action === 'undecided');
    expect(undecided?.count).toBe(1);  // User B's email untouched
  });
});
```

### Level 3: Browser Context Isolation (Playwright)

Test that browser sessions are isolated:

```typescript
// tests/browser-isolation.spec.ts
import { test, expect, Browser, BrowserContext } from '@playwright/test';

test.describe('Browser Session Isolation', () => {
  let browser: Browser;
  let userAContext: BrowserContext;
  let userBContext: BrowserContext;

  test.beforeAll(async ({ browser: b }) => {
    browser = b;

    // Create isolated contexts for each user
    userAContext = await browser.newContext({
      storageState: 'playwright/.auth/user-a.json'  // Pre-saved auth state
    });

    userBContext = await browser.newContext({
      storageState: 'playwright/.auth/user-b.json'
    });
  });

  test('User A and B see different dashboards', async () => {
    const pageA = await userAContext.newPage();
    const pageB = await userBContext.newPage();

    // Navigate both users to Execute page
    await Promise.all([
      pageA.goto('http://localhost:3000/execute'),
      pageB.goto('http://localhost:3000/execute')
    ]);

    // Get email counts for each user
    const countA = await pageA.locator('[data-testid="total-count"]').textContent();
    const countB = await pageB.locator('[data-testid="total-count"]').textContent();

    // Counts should be different (each user has different emails)
    expect(countA).not.toBe(countB);
  });

  test.afterAll(async () => {
    await userAContext.close();
    await userBContext.close();
  });
});
```

### Level 4: E2E Flow Tests (Full User Journey)

Test complete flows with real OAuth:

```typescript
// tests/e2e-multi-user.spec.ts
test.describe('Full Multi-User Flow', () => {

  test('Complete flow: Login → Refresh → Evaluate → Execute', async ({ page }) => {
    // 1. Login via OAuth (uses saved storage state)
    await page.goto('http://localhost:3000');

    // 2. Refresh emails from Gmail
    await page.getByRole('button', { name: 'Refresh from Gmail' }).click();
    await page.waitForResponse(r => r.url().includes('/api/emails/refresh'));

    // 3. Navigate to Execute page
    await page.getByRole('link', { name: 'Execute' }).click();

    // 4. Verify emails are evaluated
    await expect(page.locator('[data-testid="delete-count"]')).not.toHaveText('0');

    // 5. Re-evaluate
    await page.getByRole('button', { name: 'Re-evaluate Emails' }).click();
    await page.waitForResponse(r => r.url().includes('/api/execute/evaluate'));

    // 6. Verify summary updated
    await expect(page.locator('[data-testid="summary-section"]')).toBeVisible();
  });
});
```

---

## Implementation Plan

### Phase 1: API Key Authentication (Immediate)

**Purpose**: Enable API testing without browser session

**Files to Modify:**

| File | Change |
|------|--------|
| `server/middleware/auth.ts` | Add API key check before session check |
| `.env.example` | Add `API_KEY` template |
| `.env` | Add actual `API_KEY` (gitignored) |

**Implementation:**

```typescript
// server/middleware/auth.ts
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  // 1. Check API Key header (for CLI/testing)
  const apiKey = req.headers['x-api-key'];
  if (apiKey && apiKey === process.env.API_KEY) {
    // For testing, also check X-Test-User header
    const testUser = req.headers['x-test-user'] as string;
    if (testUser && process.env.NODE_ENV !== 'production') {
      req.user = { email: testUser };
    } else {
      req.user = { email: process.env.DEFAULT_USER || 'api@localhost' };
    }
    return next();
  }

  // 2. Check session (browser users)
  if (req.session?.userEmail) {
    req.user = { email: req.session.userEmail };
    return next();
  }

  // 3. No auth
  return res.status(401).json({
    success: false,
    error: 'Not authenticated',
    code: 'AUTH_REQUIRED'
  });
}
```

### Phase 2: Multi-User Test Suite

**Purpose**: Verify user isolation at all levels

**Files to Create:**

| File | Purpose |
|------|---------|
| `tests/multi-user-isolation.spec.ts` | API-level isolation tests |
| `tests/browser-isolation.spec.ts` | Browser context isolation tests |
| `scripts/db/08-multi-user-tests.sql` | SQL-level isolation tests |

### Phase 3: Database Token Storage (Future)

**Purpose**: Scale to multiple users properly

**New Table:**

```sql
CREATE TABLE oauth_tokens (
  id INT IDENTITY PRIMARY KEY,
  user_email NVARCHAR(255) NOT NULL UNIQUE,
  access_token NVARCHAR(MAX),      -- Encrypted
  refresh_token NVARCHAR(MAX),     -- Encrypted
  token_expiry DATETIME2,
  scopes NVARCHAR(MAX),
  created_at DATETIME2 DEFAULT GETDATE(),
  updated_at DATETIME2
);
```

### Phase 4: Background Token Refresh (Future)

**Purpose**: Prevent token expiration issues

```typescript
// Background job (runs every 10 minutes)
async function refreshExpiringTokens() {
  const expiringSoon = await getTokensExpiringSoon(15); // 15 min buffer
  for (const token of expiringSoon) {
    await refreshAndStoreToken(token.user_email);
  }
}
```

---

## Test Plan

### Test Categories

| Category | Level | What It Tests | How to Run |
|----------|-------|---------------|------------|
| SQL Isolation | Unit | Stored procedures scope by user | `docker exec ... sqlcmd -i 08-multi-user-tests.sql` |
| API Isolation | Integration | Routes respect user context | `npm run test:api -- multi-user` |
| Browser Isolation | E2E | Sessions don't leak | `npm run test:e2e -- browser-isolation` |
| Full Flow | E2E | Complete user journey | `npm run test:e2e -- e2e-multi-user` |

### Test Data Setup

```sql
-- Create test users with known data
INSERT INTO pending_emails (GmailId, user_email, FromEmail, Subject, PrimaryDomain, Action)
VALUES
  -- User A: 2 emails, 1 delete, 1 undecided
  ('test-a-1', 'test-user-a@gmail.com', 'promo@shop.com', 'Sale!', 'shop.com', 'delete'),
  ('test-a-2', 'test-user-a@gmail.com', 'alert@bank.com', 'Security', 'bank.com', NULL),

  -- User B: 1 email, undecided
  ('test-b-1', 'test-user-b@gmail.com', 'news@tech.com', 'Update', 'tech.com', NULL);
```

### Expected Results

| Test | User | Expected Result |
|------|------|-----------------|
| GET /api/execute/summary | User A | total: 2, delete: 1, undecided: 1 |
| GET /api/execute/summary | User B | total: 1, undecided: 1 |
| EXEC EvaluatePendingEmails 'User A' | User A | Only User A's emails evaluated |
| Add criteria as User A | User B | User B's criteria unchanged |

---

## Success Criteria

After implementation:

1. **API Testing Works**:
   ```bash
   curl -X POST -H "X-API-Key: xxx" /api/emails/refresh → 200 OK
   curl -H "X-API-Key: xxx" /api/execute/summary → Shows email counts
   ```

2. **Multi-User Isolation Verified**:
   - SQL tests pass: User A queries don't return User B data
   - API tests pass: Different X-Test-User headers get different data
   - Browser tests pass: Different contexts see different dashboards

3. **E2E Tests Pass Without Browser Session**:
   ```bash
   npm run test:e2e → All tests pass
   ```

4. **Full Workflow Works via API**:
   ```
   Clear → Refresh → Evaluate → Execute (all via curl)
   ```

---

## Consequences

### Positive

- Clear separation of concerns (browser auth vs API auth)
- Testable without browser automation
- Multi-user isolation verified at all levels
- Production-ready architecture documented

### Negative

- Two auth paths to maintain (session + API key)
- Test-specific headers (`X-Test-User`) could be misused if not properly secured
- More complex middleware logic

### Risks

- **API key leak**: Must keep `.env` gitignored
- **X-Test-User bypass**: Only allow in non-production environments
- **Token.json still used**: Until Phase 3, single-user file remains

---

## References

- [Microsoft Identity Platform Testing](https://learn.microsoft.com/en-us/entra/identity-platform/test-automate-integration-testing)
- [Playwright Authentication Docs](https://playwright.dev/docs/auth)
- [Playwright Browser Context Isolation](https://playwright.dev/docs/browser-contexts)
- [Multi-User Testing with Playwright Fixtures](https://medium.com/@edtang44/isolate-and-conquer-multi-user-testing-with-playwright-fixtures-f211ad438974)
- [Multi-User Test Runner (Java)](https://vincit.github.io/multi-user-test-runner/)
- ADR-001: Email Evaluation Flow (related decision)

---

## Appendix: File Locations

| File | Purpose |
|------|---------|
| `server/middleware/auth.ts` | Auth middleware (to be modified) |
| `server/routes/auth.ts` | OAuth endpoints |
| `server/index.ts` | Session configuration |
| `tests/multi-user-isolation.spec.ts` | To be created |
| `tests/browser-isolation.spec.ts` | To be created |
| `scripts/db/08-multi-user-tests.sql` | To be created |
| `.env` | API_KEY storage (gitignored) |
| `docs/adr/ADR-002-multi-user-auth.md` | This document |
