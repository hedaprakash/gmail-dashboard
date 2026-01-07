# Google Contacts Integration - Design Document

## Overview

Add a new "Contacts" page to the Gmail Dashboard for managing Google Contacts, with SQL Server storage for local querying and analysis.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────────┐
│  Contacts Page  │────►│  /api/contacts  │────►│  SQL contacts table     │
│  (React)        │     │  (Express)      │     │  + contact_emails       │
└─────────────────┘     └────────┬────────┘     └─────────────────────────┘
                                 │
                        ┌────────▼─────────┐
                        │ Google People API│
                        │  (OAuth 2.0)     │
                        └──────────────────┘
```

## Implementation Plan

### Phase 1: Database Schema
- Create `contacts` table for main contact info
- Create `contact_emails` table for multiple emails per contact
- Create `contact_phones` table for multiple phones

### Phase 2: Backend Service
- Add People API scope to OAuth
- Create `contacts.ts` service for Google People API
- Create `server/routes/contacts.ts` for API endpoints

### Phase 3: Frontend
- Create `src/pages/Contacts.tsx` page
- Add navigation link in Sidebar
- Implement sync, search, and management features

## Database Schema

```sql
-- Main contacts table
CREATE TABLE contacts (
  id INT IDENTITY PRIMARY KEY,
  user_email NVARCHAR(255) NOT NULL,
  google_resource_name NVARCHAR(100) NOT NULL,  -- 'people/c12345...'
  display_name NVARCHAR(255),
  given_name NVARCHAR(100),
  family_name NVARCHAR(100),
  photo_url NVARCHAR(500),
  organization NVARCHAR(255),
  job_title NVARCHAR(255),
  notes NVARCHAR(MAX),
  last_synced DATETIME2 DEFAULT GETDATE(),
  created_at DATETIME2 DEFAULT GETDATE(),
  updated_at DATETIME2 DEFAULT GETDATE(),
  CONSTRAINT UQ_contact_user UNIQUE(google_resource_name, user_email)
);

-- Contact emails (one-to-many)
CREATE TABLE contact_emails (
  id INT IDENTITY PRIMARY KEY,
  contact_id INT NOT NULL FOREIGN KEY REFERENCES contacts(id) ON DELETE CASCADE,
  email NVARCHAR(255) NOT NULL,
  type NVARCHAR(50),  -- 'home', 'work', 'other'
  is_primary BIT DEFAULT 0
);

-- Contact phone numbers (one-to-many)
CREATE TABLE contact_phones (
  id INT IDENTITY PRIMARY KEY,
  contact_id INT NOT NULL FOREIGN KEY REFERENCES contacts(id) ON DELETE CASCADE,
  phone NVARCHAR(50) NOT NULL,
  type NVARCHAR(50)  -- 'mobile', 'home', 'work'
);

-- Indexes
CREATE INDEX idx_contacts_user ON contacts(user_email);
CREATE INDEX idx_contacts_display_name ON contacts(display_name);
CREATE INDEX idx_contact_emails_email ON contact_emails(email);
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/contacts` | List all contacts (paginated) |
| GET | `/api/contacts/:id` | Get single contact details |
| POST | `/api/contacts/sync` | Sync from Google People API |
| GET | `/api/contacts/search?q=` | Search contacts |
| GET | `/api/contacts/stats` | Get contact statistics |
| GET | `/api/contacts/by-email/:email` | Find contact by email |

## OAuth Scope

Add to SCOPES array:
```typescript
const SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/contacts.readonly'
];
```

## UI Features

1. **Contacts List**
   - Avatar, name, primary email, organization
   - Search/filter bar
   - Sort by name, last synced

2. **Contact Card**
   - Full details with all emails/phones
   - Link to email history in Gmail

3. **Sync Dashboard**
   - Last sync time
   - Sync button with progress
   - Sync statistics

4. **Cross-reference with Emails**
   - Show "X emails from this contact"
   - Quick link to Review page filtered by contact

## File Structure

```
server/
  routes/
    contacts.ts          # API endpoints
  services/
    contacts.ts          # Google People API service
scripts/db/
  09-create-contacts-tables.sql
src/
  pages/
    Contacts.tsx         # Main contacts page
  hooks/
    useContacts.ts       # React Query hooks
  components/
    Contacts/
      ContactCard.tsx
      ContactList.tsx
      SyncStatus.tsx
```
