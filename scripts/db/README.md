# Database Scripts

Scripts for setting up and managing the Gmail Criteria SQL Server database.

## Quick Start

```bash
# From gmail-dashboard directory:

# 1. Copy .env.example to .env and adjust if needed
cp .env.example .env

# 2. Start SQL Server
docker-compose up -d

# 3. Run setup (creates schema + migrates data + stored procedures)
./scripts/db/setup.sh
```

## Scripts

| File | Purpose |
|------|---------|
| `01-init-schema.sql` | Creates database and tables |
| `02-migrate-data.sql` | Migrates data from criteria_unified.json |
| `03-create-evaluate-procedure.sql` | Creates EvaluateEmails stored procedure |
| `04-test-evaluate-procedure.sql` | Basic test script |
| `05-comprehensive-test.sql` | Full test suite (42 cases including delete_10d, all PASS) |
| `setup.sh` | One-command setup script |
| `generate-migration.cjs` | Regenerates 02-migrate-data.sql |

## Environment Variables

Configuration is stored in `.env` file (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | localhost | SQL Server host |
| `DB_PORT` | 1433 | SQL Server port |
| `DB_NAME` | GmailCriteria | Database name |
| `DB_USER` | sa | Database user |
| `DB_PASSWORD` | MyPass@word123 | Database password |

## Schema

### criteria
Primary domains, subdomains, and email addresses.

| Column | Type | Description |
|--------|------|-------------|
| id | INT | Primary key |
| key_value | NVARCHAR(255) | Domain or email (e.g., 'example.com') |
| key_type | NVARCHAR(20) | 'domain', 'subdomain', or 'email' |
| default_action | NVARCHAR(20) | 'delete', 'delete_1d', 'keep', or NULL |
| parent_id | INT | FK to parent domain (for subdomains) |

### patterns
Subject patterns for matching emails.

| Column | Type | Description |
|--------|------|-------------|
| id | INT | Primary key |
| criteria_id | INT | FK to criteria |
| action | NVARCHAR(20) | 'keep', 'delete', or 'delete_1d' |
| pattern | NVARCHAR(500) | Subject pattern to match |

### email_patterns
Email address patterns (fromEmails/toEmails).

| Column | Type | Description |
|--------|------|-------------|
| id | INT | Primary key |
| criteria_id | INT | FK to criteria |
| direction | NVARCHAR(10) | 'from' or 'to' |
| action | NVARCHAR(20) | 'keep' or 'delete' |
| email | NVARCHAR(255) | Email address to match |

### test_emails
For running the 42 comprehensive test cases.

| Column | Type | Description |
|--------|------|-------------|
| EmailId | NVARCHAR(10) | Test case ID (A1, B2, etc.) |
| FromEmail | NVARCHAR(255) | Sender email |
| ToEmail | NVARCHAR(255) | Recipient email |
| Subject | NVARCHAR(500) | Email subject |
| PrimaryDomain | NVARCHAR(255) | Sender's primary domain |
| Subdomain | NVARCHAR(255) | Sender's subdomain (if any) |
| EmailDate | DATETIME | Email timestamp |
| ExpectedAction | NVARCHAR(20) | Expected action (for verification) |
| Action | NVARCHAR(20) | Actual action (populated by proc) |
| TestResult | COMPUTED | 'PASS' or 'FAIL' |

### pending_emails
For evaluating real Gmail emails.

| Column | Type | Description |
|--------|------|-------------|
| Id | INT IDENTITY | Auto-increment ID |
| GmailId | NVARCHAR(100) | Gmail message ID (unique) |
| FromEmail | NVARCHAR(255) | Sender email |
| ToEmail | NVARCHAR(255) | Recipient email |
| Subject | NVARCHAR(500) | Email subject |
| PrimaryDomain | NVARCHAR(255) | Sender's primary domain |
| Subdomain | NVARCHAR(255) | Sender's subdomain |
| EmailDate | DATETIME | Email timestamp |
| ReceivedAt | DATETIME | When fetched |
| Action | NVARCHAR(20) | Action (populated by proc) |
| MatchedRule | NVARCHAR(100) | Which rule matched |
| ProcessedAt | DATETIME | When evaluation ran |

## Stored Procedures

### EvaluateEmails

Evaluates a batch of emails against all criteria rules. Returns the action for each email.

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| @Emails | EmailInputType | Table of emails to evaluate |
| @MinAgeDays | INT | Only evaluate emails older than N days (default: 0) |
| @Verbose | BIT | 1 = include match details in output (default: 0) |

**Usage:**
```sql
DECLARE @TestEmails dbo.EmailInputType;

INSERT INTO @TestEmails (EmailId, FromEmail, ToEmail, Subject, PrimaryDomain, Subdomain, EmailDate)
VALUES
    ('E001', 'newsletter@example.com', 'me@gmail.com', 'Weekly Newsletter', 'example.com', NULL, GETDATE());

-- Verbose output with match details
EXEC dbo.EvaluateEmails @Emails = @TestEmails, @Verbose = 1;

-- Compact output
EXEC dbo.EvaluateEmails @Emails = @TestEmails, @Verbose = 0;
```

**Matching Priority (11 levels, highest to lowest):**
1. Email address as top-level key
2. fromEmails keep rules
3. fromEmails delete rules
4. toEmails keep rules
5. toEmails delete rules
6. Subject keep patterns
7. Subject delete patterns
8. Subject delete_1d patterns
9. Subject delete_10d patterns
10. Default action (keep, delete, delete_1d, delete_10d)
11. No match = undecided

**Supported Actions:**
- `keep` - Never delete
- `delete` - Delete immediately
- `delete_1d` - Delete after 1 day (protects OTPs)
- `delete_10d` - Delete after 10 days (for archives)

### EvaluateEmailsSimple

Simplified version of EvaluateEmails that returns only 3 columns (no summary). Useful for INSERT INTO...EXEC patterns.

```sql
DECLARE @Emails dbo.EmailInputType;
-- ... insert emails ...
INSERT INTO #Results EXEC dbo.EvaluateEmailsSimple @Emails = @Emails;
```

### EvaluateTestEmails

Evaluates the `test_emails` table and updates the `Action` column. Used for running the 37 test cases.

```sql
EXEC dbo.EvaluateTestEmails;
SELECT EmailId, ExpectedAction, Action, TestResult FROM test_emails ORDER BY EmailId;
```

### EvaluatePendingEmails

Evaluates the `pending_emails` table and updates the `Action` and `MatchedRule` columns. Used for evaluating real Gmail emails.

```sql
EXEC dbo.EvaluatePendingEmails;
SELECT * FROM pending_emails WHERE Action = 'undecided';
```

## Running Tests

Run the comprehensive test suite (42 test cases, including delete_10d):

```bash
# Copy and run test script
docker cp scripts/db/05-comprehensive-test.sql gmail-sqlserver:/tmp/
docker exec gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "MyPass@word123" -C -d GmailCriteria \
  -i /tmp/05-comprehensive-test.sql

# View results (all should show PASS)
docker exec gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "MyPass@word123" -C -d GmailCriteria \
  -Q "SELECT EmailId, ExpectedAction, Action, TestResult FROM test_emails ORDER BY EmailId" -W
```

## Regenerating Migration Data

If you update `criteria_unified.json` and need to regenerate `02-migrate-data.sql`:

```bash
node scripts/db/generate-migration.cjs
```

## Manual Commands

```bash
# Connect to SQL Server interactively
docker exec -it gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "$DB_PASSWORD" -C -d GmailCriteria

# Check counts
docker exec gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "$DB_PASSWORD" -C -d GmailCriteria \
  -Q "SELECT key_type, COUNT(*) FROM criteria GROUP BY key_type"

# Run tests
docker exec gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "$DB_PASSWORD" -C -d GmailCriteria \
  -i /tmp/04-test-evaluate-procedure.sql
```
