# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

**Gmail Dashboard** is a web-based email cleanup management system that helps users review, categorize, and delete unwanted emails from their Gmail inbox.

### Key Features
- **Review Page**: View emails grouped by domain/subdomain/sender, with one-click delete/keep actions
- **Criteria Manager**: Manage deletion rules with domain-level and pattern-based filtering
- **Execute Page**: Preview and execute batch email deletions based on criteria
- **Stats Page**: View email statistics and criteria summary

### Technology Stack
- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS + React Query
- **Backend**: Express.js 5 + TypeScript
- **Database**: SQL Server (Docker) for criteria storage and email evaluation
- **Gmail API**: Google OAuth2 for email access

## Quick Start

```bash
# Install dependencies
npm install

# Start development servers (frontend on :3000, backend on :5000)
npm run dev

# Run E2E tests (requires dev servers running)
npm run test:e2e
```

## Project Structure

```
gmail-dashboard/
├── data/                      # Data files (gitignored sensitive files)
│   ├── credentials.json       # Google OAuth credentials (user provides, gitignored)
│   ├── credentials.example.json # Template for credentials
│   ├── token.json             # OAuth token (auto-generated, gitignored)
│   └── criteria_unified.json  # Unified criteria rules (tracked)
├── logs/                      # Cached emails and action logs (gitignored)
├── server/                    # Express.js backend
│   ├── index.ts               # Server entry point
│   ├── config/
│   │   └── database.ts        # SQL Server connection config
│   ├── routes/
│   │   ├── emails.ts          # Email listing and refresh endpoints
│   │   ├── actions.ts         # Keep/delete action endpoints
│   │   ├── criteria.ts        # Criteria management endpoints
│   │   └── execute.ts         # Batch deletion endpoints
│   └── services/
│       ├── criteria.ts        # Criteria matching logic (dual JSON + SQL)
│       ├── gmail.ts           # Gmail API service
│       ├── cache.ts           # Email caching service
│       ├── database.ts        # SQL Server queries
│       └── actionLogger.ts    # Action logging
├── src/                       # React frontend
│   ├── pages/
│   │   ├── Review.tsx         # Main email review page
│   │   ├── CriteriaManager.tsx # Criteria management UI
│   │   ├── Execute.tsx        # Batch deletion page
│   │   └── Stats.tsx          # Statistics page
│   ├── hooks/
│   │   ├── useEmails.ts       # Email data hooks
│   │   └── useCriteria.ts     # Criteria data hooks
│   └── components/            # Reusable UI components
├── scripts/db/                # SQL Server setup scripts
├── tests/
│   └── e2e.spec.ts            # Playwright E2E tests (30 tests)
└── docker-compose.yml         # SQL Server container
```

## Architecture

### Data Flow

1. **Gmail Refresh**: Fetches unread emails from Gmail API → saves to local cache (`logs/emails_categorized_*.json`) → inserts into SQL Server `pending_emails` table
2. **Criteria Evaluation**: Stored procedure `EvaluatePendingEmails` evaluates all pending emails against criteria rules
3. **Review Page**: Displays undecided emails grouped by domain, allows user to add keep/delete rules
4. **Criteria Storage**: Dual-write strategy - saves to both `data/criteria_unified.json` (backup) and SQL Server `criteria` table
5. **Execute Page**: Reads from `pending_emails` table, executes batch deletions via Gmail API

### Action Types

| Action | Description |
|--------|-------------|
| `delete` | Delete immediately |
| `delete_1d` | Delete if email is older than 1 day (protects OTPs) |
| `delete_10d` | Delete if email is older than 10 days |
| `keep` | Never delete (safe list) |
| `undecided` | No matching rule, needs review |

### Unified Criteria Format

```json
{
  "example.com": {
    "default": "delete",           // Default action for domain
    "keep": ["important"],         // Subject patterns to keep
    "delete": ["newsletter"],      // Subject patterns to delete
    "delete_1d": ["verification"], // Delete after 1 day
    "delete_10d": ["promotion"],   // Delete after 10 days
    "subdomains": {
      "mail": {
        "default": "keep"          // Override for mail.example.com
      }
    }
  }
}
```

## Database Setup

```bash
# Start SQL Server container
docker-compose up -d

# Run setup scripts (creates tables, stored procedures)
./scripts/db/setup.sh

# Or manually run the SQL scripts in order:
# 01-create-database.sql
# 02-create-tables.sql
# 03-create-evaluate-procedure.sql
# 04-import-criteria.sql
```

### Key Tables
- `criteria` - Domain/subdomain entries with default actions
- `patterns` - Subject pattern rules (keep, delete, delete_1d, delete_10d)
- `email_patterns` - fromEmails/toEmails rules
- `pending_emails` - Emails awaiting evaluation/deletion

### Key Stored Procedures
- `EvaluatePendingEmails` - Batch evaluates all pending emails against criteria

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/emails` | GET | List grouped emails from cache |
| `/api/emails/refresh` | POST | Fetch fresh emails from Gmail |
| `/api/emails/stats` | GET | Get email statistics |
| `/api/criteria` | GET | List all criteria rules |
| `/api/actions/add-criteria` | POST | Add delete rule |
| `/api/actions/add-criteria-1d` | POST | Add delete_1d rule |
| `/api/actions/add-criteria-10d` | POST | Add delete_10d rule |
| `/api/actions/mark-keep` | POST | Add keep rule |
| `/api/execute/summary` | GET | Get pending emails summary by action |
| `/api/execute/preview` | POST | Preview emails to be deleted |
| `/api/execute/delete` | POST | Execute batch deletion |
| `/api/execute/evaluate` | POST | Re-evaluate all pending emails |

## Commands

```bash
# Development
npm run dev              # Start both servers
npm run dev:client       # Start only frontend (Vite)
npm run dev:server       # Start only backend (nodemon)

# Testing
npm run test:e2e         # Run Playwright tests
npm run test:criteria    # Test criteria matching logic

# Database
npm run db:compare       # Compare JSON vs SQL criteria
npm run db:export        # Export SQL criteria to JSON
npm run db:import        # Import JSON criteria to SQL

# Production
npm run build            # Build frontend and backend
npm run start            # Start production server
```

## Environment Variables

Create a `.env` file (already gitignored):

```env
# SQL Server connection
DB_USER=sa
DB_PASSWORD=YourPassword123!
DB_SERVER=localhost
DB_DATABASE=GmailCriteria
DB_PORT=1433

# Enable SQL database (default: true)
USE_SQL_DATABASE=true
```

## Setup for New Users

1. **Install dependencies**: `npm install`

2. **Set up Google OAuth credentials**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a project and enable Gmail API
   - Create OAuth 2.0 credentials (Desktop app)
   - Download credentials and save to `data/credentials.json`

3. **Generate OAuth token**:
   - Run the Python scripts in the parent `gmail/` folder first to generate `token.json`
   - Or implement OAuth flow in the Node.js app

4. **Set up SQL Server**:
   ```bash
   docker-compose up -d
   ./scripts/db/setup.sh
   ```

5. **Start development**:
   ```bash
   npm run dev
   ```
   - Frontend: http://localhost:3000
   - Backend: http://localhost:5000

## Key Design Decisions

### 1. Dual-Write Strategy
Criteria changes are saved to both JSON file and SQL Server. This provides:
- JSON as human-readable backup
- SQL for fast batch evaluation with stored procedures

### 2. Caching Strategy
- Gmail API calls are expensive (rate limits + time)
- Emails cached locally in `logs/emails_categorized_*.json`
- Cache refreshed only on explicit "Refresh from Gmail" click
- Cache auto-expires after 5 hours

### 3. Pending Emails Table
- All unread emails stored in `pending_emails` table
- Stored procedure evaluates against criteria rules
- Actions: delete, delete_1d, delete_10d, keep, undecided

### 4. Keep Takes Priority
- Keep rules always override delete rules
- Prevents accidental deletion of important emails

## Testing

### Run All E2E Tests
```bash
# Start dev servers first
npm run dev

# In another terminal
npm run test:e2e
```

### Test Coverage (30 tests)
- Navigation (4 tests)
- Review Page (3 tests)
- Stats Page (3 tests)
- Criteria Manager (6 tests)
- Execute Page (8 tests)
- Text Selection (2 tests)
- Delete 10d Feature (3 tests)
- API Integration (2 tests)

## Common Issues

### Port already in use
```bash
# Kill processes on ports 3000 and 5000
npx kill-port 3000 5000
```

### SQL Server connection failed
```bash
# Check if container is running
docker ps

# Restart SQL Server
docker-compose down && docker-compose up -d
```

### Token expired
- Delete `data/token.json`
- Re-run OAuth flow to generate new token

## File Locations Reference

| File | Purpose |
|------|---------|
| `data/criteria_unified.json` | Main criteria rules (tracked in git) |
| `data/credentials.json` | Google OAuth credentials (gitignored) |
| `data/token.json` | OAuth token (gitignored) |
| `logs/*.json` | Cached email data (gitignored) |
| `logs/actions.log` | User action history (gitignored) |
| `.env` | Environment variables (gitignored) |

## Skills

### /test-app
**Trigger phrases:** "test the app", "run tests", "test everything", "initiate testing", "run /test-app", "start and test"

**Action:** Immediately execute the full test workflow without asking questions.

**Workflow:**
1. Kill existing processes on ports 3000 and 5000
2. Start the dev servers (`npm run dev`)
3. Wait for servers to be ready (check health endpoints)
4. Run Playwright E2E tests
5. Check OAuth authentication status
6. Generate a status report

**Report format:**
```
## Test Report

### Server Status
- Backend (5000): ✅ Running / ❌ Down
- Frontend (3000): ✅ Running / ❌ Down

### Authentication
- Status: ✅ Authenticated / ❌ Not authenticated

### E2E Tests
- Total: X tests
- Passed: X ✅
- Failed: X ❌

### Quick Links
- Dashboard: http://localhost:3000
- API Health: http://localhost:5000/api/health
```

---

## Rules for Claude (MUST FOLLOW)

### 1. Never Use Alternative Ports
- **ALWAYS** kill existing processes before starting servers
- **NEVER** let Vite or Express use a different port if the default is busy
- Use `npx kill-port 3000 5000` before starting dev servers
- The `npm run dev` script already does this automatically

### 2. Starting Dev Servers
```bash
# Correct way - kills existing and starts fresh
npm run dev

# If running manually, always kill first
npx kill-port 3000 5000 && npm run dev
```

### 3. Port Assignments (Fixed)
- Frontend (Vite): **3000** - never use 3001 or other ports
- Backend (Express): **5000** - never use 5001 or other ports
- Vite is configured with `--strictPort` to fail instead of using alternative ports

### 4. Background Tasks
- When starting servers in background, always verify they started on correct ports
- If ports are wrong, kill and restart - don't proceed with wrong ports

### 5. Never Run Destructive Git Commands Without Permission
- **NEVER** run `git reset --hard`, `git clean -fd`, `git checkout .`, or any command that discards uncommitted work without **explicit user permission**
- **ALWAYS** ask before running any command that could delete or overwrite uncommitted changes
- When fixing issues (like line endings), explain the solution first and ask for approval before executing

### 6. Explain Plan Before Writing Code
- **ALWAYS** explain what you plan to do BEFORE writing or modifying code
- Describe the changes you'll make and which files will be affected
- Wait for user acknowledgment before implementing
- Format: "Here's my plan: [explanation]. Should I proceed?"
