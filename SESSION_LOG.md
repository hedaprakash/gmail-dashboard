# Session Log - Gmail Dashboard

## Current State (2026-01-03)

### Latest Update: Added delete_10d Support
Added support for 10-day delayed deletion throughout the entire application:
- **SQL Database**: Updated stored procedure with P9_SubjectDelete10dMatch
- **Python Flask API**: Added `/api/add-criteria-10d` endpoint
- **Node.js Server**: Added actions route, criteria service updates
- **Dashboard UI**: Added "Del 10d" buttons at domain, subdomain, and pattern levels
- **Test Suite**: Now 42 test cases (added delete_10d test cases C6, C7, I1, I2, I3)

### What's Been Built

#### 1. SQL Server Database (Complete)
- **Container:** `gmail-sqlserver` running on port 1433
- **Database:** `GmailCriteria`
- **Tables:**
  - `criteria` - 435 entries (425 domains, 9 subdomains, 1 email)
  - `patterns` - 81 subject patterns
  - `email_patterns` - For fromEmails/toEmails rules
  - `test_emails` - 37 test cases with ExpectedAction/Action/TestResult
  - `pending_emails` - Real Gmail emails for evaluation

#### 2. Stored Procedures (Complete)

| Procedure | Purpose |
|-----------|---------|
| `EvaluateEmails` | Core evaluation logic, returns results with verbose/compact modes |
| `EvaluateEmailsSimple` | Simplified version for INSERT INTO...EXEC (no summary) |
| `EvaluateTestEmails` | Evaluates test_emails table, updates Action column |
| `EvaluatePendingEmails` | Evaluates pending_emails table, updates Action column |

**Usage:**
```sql
-- Evaluate test cases
EXEC dbo.EvaluateTestEmails;
SELECT * FROM test_emails ORDER BY EmailId;

-- Evaluate real Gmail emails
EXEC dbo.EvaluatePendingEmails;
SELECT * FROM pending_emails WHERE Action = 'undecided';
```

**Matching Priority (11 levels, implemented):**
1. Email address as top-level key (highest)
2. fromEmails keep rules
3. fromEmails delete rules
4. toEmails keep rules
5. toEmails delete rules
6. Subject keep patterns
7. Subject delete patterns
8. Subject delete_1d patterns
9. Subject delete_10d patterns
10. Default action (keep, delete, delete_1d, delete_10d)
11. No match = undecided (lowest)

#### 3. Comprehensive Test Suite (Complete)
**Location:** `scripts/db/05-comprehensive-test.sql`

All 42 test cases PASS:
- Group A: Default delete domain (8 tests)
- Group B: Default keep domain (5 tests)
- Group C: Mixed domain - no default (7 tests, includes delete_10d patterns)
- Group D: Parent/subdomain hierarchy (9 tests)
- Group E: Email key override (3 tests)
- Group F: delete_1d default (2 tests)
- Group G: Unknown domains (2 tests)
- Group H: Priority conflicts (3 tests)
- Group I: delete_10d default domain (3 tests)

**Actions Supported:**
- `keep` - Never delete
- `delete` - Delete immediately
- `delete_1d` - Delete after 1 day (protects OTPs)
- `delete_10d` - Delete after 10 days (for archives)

**Test Results Table:**
```sql
SELECT EmailId, Subject, ExpectedAction, Action, TestResult
FROM test_emails ORDER BY EmailId;
```

#### 4. Python Gmail Integration (Complete)
**Location:** `../load_emails_to_sql.py`

Fetches unread Gmail emails and evaluates them using SQL stored procedures.

```bash
# Fetch and evaluate unread emails (clears existing)
python load_emails_to_sql.py --max 500 --clear

# Just show current results without fetching
python load_emails_to_sql.py --show-only

# Fetch more emails (appends to existing)
python load_emails_to_sql.py --max 200
```

**Dependencies:** `pymssql` (install with `pip install pymssql`)

#### 5. Environment Configuration (Complete)
- `.env` and `.env.example` created
- `docker-compose.yaml` uses environment variables
- `setup.sh` reads from `.env`
- `.gitignore` protects secrets

#### 6. Node.js Integration (Complete)
- `server/config/database.ts` - SQL Server connection config
- `server/services/database.ts` - Connection pool and query utilities
- `server/services/criteria.ts` - Updated with SQL support and fromEmails/toEmails
- `server/scripts/sync-criteria.ts` - Sync between JSON and SQL

### File Structure

```
gmail/
├── load_emails_to_sql.py             # NEW: Fetch Gmail → SQL → Evaluate
├── credentials.json                   # Google OAuth2 (user provides)
├── token.json                         # OAuth2 token (auto-generated)
│
└── gmail-dashboard/
    ├── .env                              # Environment variables (gitignored)
    ├── .env.example                      # Template for .env
    ├── .gitignore                        # Ignores .env, node_modules, etc.
    ├── docker-compose.yaml               # SQL Server container config
    ├── CRITERIA_SPEC.md                  # Complete criteria specification
    ├── package.json                      # Includes mssql dependency
    │
    ├── scripts/db/
    │   ├── README.md                     # Database documentation
    │   ├── setup.sh                      # One-command setup script
    │   ├── 01-init-schema.sql           # Creates database and tables
    │   ├── 02-migrate-data.sql          # Migrates JSON data to SQL
    │   ├── 03-create-evaluate-procedure.sql  # EvaluateEmails stored procedure
    │   ├── 04-test-evaluate-procedure.sql    # Basic tests
    │   ├── 05-comprehensive-test.sql         # Full test suite (42 cases)
    │   └── generate-migration.cjs       # Regenerates 02-migrate-data.sql
    │
    └── server/
        ├── config/
        │   └── database.ts              # SQL Server connection config
        ├── services/
        │   ├── database.ts              # Connection pool, query utilities
        │   └── criteria.ts              # Criteria matching (JSON + SQL)
        └── scripts/
            └── sync-criteria.ts         # JSON <-> SQL sync utility
```

### SQL Tables

#### test_emails
For running the 42 test cases with PASS/FAIL verification.

| Column | Type | Description |
|--------|------|-------------|
| EmailId | NVARCHAR(10) | Test case ID (A1, B2, etc.) |
| FromEmail | NVARCHAR(255) | Sender email |
| ToEmail | NVARCHAR(255) | Recipient email |
| Subject | NVARCHAR(500) | Email subject |
| PrimaryDomain | NVARCHAR(255) | Sender's primary domain |
| Subdomain | NVARCHAR(255) | Sender's subdomain (if any) |
| EmailDate | DATETIME | Email timestamp |
| ExpectedAction | NVARCHAR(20) | Expected action (for test verification) |
| Action | NVARCHAR(20) | Actual action (populated by stored proc) |
| TestResult | COMPUTED | 'PASS' or 'FAIL' based on Expected vs Actual |

#### pending_emails
For evaluating real Gmail emails.

| Column | Type | Description |
|--------|------|-------------|
| Id | INT IDENTITY | Auto-increment ID |
| GmailId | NVARCHAR(100) | Gmail message ID (unique) |
| FromEmail | NVARCHAR(255) | Sender email |
| ToEmail | NVARCHAR(255) | Recipient email |
| Subject | NVARCHAR(500) | Email subject |
| PrimaryDomain | NVARCHAR(255) | Sender's primary domain |
| Subdomain | NVARCHAR(255) | Sender's subdomain (if any) |
| EmailDate | DATETIME | Email timestamp |
| ReceivedAt | DATETIME | When we fetched it |
| Action | NVARCHAR(20) | Action (populated by stored proc) |
| MatchedRule | NVARCHAR(100) | Which rule matched |
| ProcessedAt | DATETIME | When evaluation ran |

### Quick Start Commands

```bash
# Start SQL Server
cd gmail-dashboard
docker-compose up -d

# Run full setup (schema + data + procedures)
./scripts/db/setup.sh

# Run comprehensive tests (37 test cases)
docker cp scripts/db/05-comprehensive-test.sql gmail-sqlserver:/tmp/
docker exec gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "MyPass@word123" -C -d GmailCriteria \
  -i /tmp/05-comprehensive-test.sql

# View test results
docker exec gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "MyPass@word123" -C -d GmailCriteria \
  -Q "SELECT EmailId, ExpectedAction, Action, TestResult FROM test_emails ORDER BY EmailId"

# Evaluate real Gmail emails
cd ..
source venv/Scripts/activate
python load_emails_to_sql.py --max 200 --clear

# Start Node.js server with SQL enabled
cd gmail-dashboard
USE_SQL_DATABASE=true npm run dev
```

### NPM Scripts Available

```bash
npm run dev              # Start dev server (Vite + Express)
npm run db:compare       # Compare JSON and SQL data
npm run db:export        # Export SQL to JSON
npm run db:import        # Import JSON to SQL
```

### What's Next (Suggested)

1. **Add rules for undecided domains**
   - hdfcbank.net (11 emails)
   - etradefrommorganstanley.com (7 emails)
   - lenovo.com, ralphlauren.com, etc.

2. **Connect Python delete script to SQL**
   - Update `delete_gmails.py` to call `EvaluateEmails` stored procedure
   - This ensures Python and Node.js use the exact same logic

3. **Add validation stored procedure**
   - Create procedure to detect "oxymoron" violations
   - Validate criteria before allowing inserts

4. **Build criteria management UI**
   - CRUD operations for criteria via the dashboard
   - Real-time validation feedback

5. **Add audit logging**
   - Log every delete decision with the matched rule
   - Track what was deleted and why

### Key Design Decisions

1. **SQL is the source of truth** - JSON kept as backup only
2. **Dual-write strategy** - Writes go to both JSON and SQL
3. **Set-based processing** - No loops/cursors in stored procedure
4. **Priority-based matching** - Higher priority rules win (email > fromEmails > pattern > default)
5. **Subdomain isolation** - Subdomain rules completely override parent
6. **Test-driven** - 42 test cases verify all matching scenarios

### Database Connection

```
Host: localhost
Port: 1433
Database: GmailCriteria
User: sa
Password: (see .env file)
```

### Test Results Summary

All 42 test cases pass. Key scenarios verified:
- Default actions (delete, delete_1d, delete_10d, keep)
- Subject pattern matching (keep > delete > delete_1d > delete_10d)
- fromEmails/toEmails rules (highest priority)
- Subdomain overrides parent
- Email address keys override domain
- Unknown domains = undecided
- Priority conflicts resolved correctly
- 10-day delayed deletion for archives
