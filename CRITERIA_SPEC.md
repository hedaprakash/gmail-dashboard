# criteria_unified.json Specification

## CRITICAL RULE (Never Forget!)

**When `default` is set, you can ONLY have the OPPOSITE pattern type:**
- `default: "delete"` → ONLY `keep` patterns allowed
- `default: "keep"` → ONLY `delete`/`delete_1d` patterns allowed
- No `default` → Any combination allowed (unmatched = undecided)

**Having both `keep` AND `delete` patterns WITH a default is INVALID (oxymoron).**

---

## Complete Annotated Example

```jsonc
{
  // PRIMARY DOMAIN with default: "delete"
  // Rule: When default is "delete", you can ONLY have "keep" patterns (no delete/delete_1d)
  "example.com": {
    "default": "delete",                    // Delete everything from this domain...
    "keep": ["Order", "Receipt"],           // ...EXCEPT emails with these subjects
    // "delete": ["Newsletter"],            // INVALID! Can't have delete patterns when default is delete
    // "delete_1d": ["OTP"],                // INVALID! Same reason

    // Email-level overrides (more granular than subject patterns)
    "fromEmails": {
      "keep": ["ceo@example.com"],          // Always keep emails FROM this sender
      "delete": ["spam@example.com"]        // Always delete emails FROM this sender
    },
    "toEmails": {
      "keep": ["important@example.com"],    // Always keep emails TO this recipient
      "delete": ["old@example.com"]         // Always delete emails TO this recipient
    },

    // SUBDOMAINS - must be nested here, never as top-level keys
    "subdomains": {

      // Subdomain with default: "keep" (opposite of parent)
      // Rule: When default is "keep", you can ONLY have "delete/delete_1d" patterns (no keep)
      "alerts.example.com": {
        "default": "keep",                  // Keep everything from this subdomain...
        "delete": ["Weekly digest"],        // ...EXCEPT emails with these subjects
        // "keep": ["Important"],           // INVALID! Can't have keep patterns when default is keep
        "fromEmails": {
          "delete": ["noreply@alerts.example.com"]
        }
      },

      // Subdomain with NO default (mixed patterns allowed)
      // Rule: When no default, you can have any combination of patterns
      // Unmatched emails = UNDECIDED (needs manual review)
      "notifications.example.com": {
        // No default - explicitly undecided for unmatched
        "keep": ["Security alert"],         // Keep these
        "delete": ["Promo"],                // Delete these
        "delete_1d": ["Login code"],        // Delete after 1 day
        // Everything else = UNDECIDED
        "fromEmails": {
          "keep": ["security@notifications.example.com"],
          "delete": ["marketing@notifications.example.com"]
        }
      },

      // Simple subdomain - just default, no patterns
      "marketing.example.com": {
        "default": "delete"                 // Delete everything from this subdomain
      }
    }
  },

  // EMAIL ADDRESS as top-level key (matches specific sender)
  // Takes priority over domain rules (granular wins)
  "someone@gmail.com": {
    "default": "keep"                       // Keep all emails from this specific person
    // Even though gmail.com might have default: "delete"
  }
}
```

---

## Matching Priority

Most specific wins, evaluated in this order:

1. `fromEmails` / `toEmails` rules (most granular)
2. `keep` patterns (subject match)
3. `delete` patterns (subject match)
4. `delete_1d` patterns (subject match)
5. `default` action (fallback)
6. No match + no default = **UNDECIDED**

---

## Valid Structures

| Structure | Meaning |
|-----------|---------|
| `default: "delete"` only | Delete ALL from this domain |
| `default: "delete"` + `keep: [...]` | Delete all EXCEPT these patterns |
| `default: "keep"` only | Keep ALL from this domain |
| `default: "keep"` + `delete: [...]` | Keep all EXCEPT these patterns |
| No default + any patterns | Only matched emails decided, rest undecided |

---

## Invalid Structures (NEVER DO)

| Structure | Why Invalid |
|-----------|-------------|
| `default: "delete"` + `delete: [...]` | Redundant - default already deletes |
| `default: "keep"` + `keep: [...]` | Redundant - default already keeps |
| `default` + both `keep` AND `delete` | Oxymoron - conflicting rules |
| Subdomain as top-level key | Must nest under parent's `subdomains` |

---

## Key Types

| Type | Example | Location |
|------|---------|----------|
| Primary domain | `example.com` | Top-level key |
| Primary domain (3-part TLD) | `sbi.co.in` | Top-level key |
| Subdomain | `alerts.example.com` | Under parent's `subdomains` |
| Email address | `someone@gmail.com` | Top-level key |

---

## Rules Summary

1. **Subdomains** MUST be nested under parent domain's `subdomains` field
2. **Parent domain** MUST exist before adding subdomain
3. **No orphaned subdomains** at top level
4. **Email address keys** take priority over domain rules (granular wins)
5. **`fromEmails`/`toEmails`** only support `keep` and `delete` (no `delete_1d`)

---

## SQL Server Database

The criteria are stored in SQL Server for better querying and validation.

### Connection Details

| Property | Value |
|----------|-------|
| Host | localhost |
| Port | 1433 |
| Database | GmailCriteria |
| User | sa |
| Password | MyPass@word123 |

### Schema

```sql
-- Primary domains, subdomains, and email addresses
CREATE TABLE criteria (
    id INT IDENTITY PRIMARY KEY,
    key_value NVARCHAR(255) NOT NULL UNIQUE,    -- 'example.com' or 'someone@gmail.com'
    key_type NVARCHAR(20) NOT NULL,              -- 'domain', 'subdomain', 'email'
    default_action NVARCHAR(20) NULL,            -- 'delete', 'delete_1d', 'keep', NULL
    parent_id INT NULL,                          -- FK to parent (for subdomains)
    FOREIGN KEY (parent_id) REFERENCES criteria(id)
);

-- Subject patterns
CREATE TABLE patterns (
    id INT IDENTITY PRIMARY KEY,
    criteria_id INT NOT NULL,
    action NVARCHAR(20) NOT NULL,                -- 'keep', 'delete', 'delete_1d'
    pattern NVARCHAR(500) NOT NULL,
    FOREIGN KEY (criteria_id) REFERENCES criteria(id) ON DELETE CASCADE
);

-- Email address patterns (fromEmails/toEmails)
CREATE TABLE email_patterns (
    id INT IDENTITY PRIMARY KEY,
    criteria_id INT NOT NULL,
    direction NVARCHAR(10) NOT NULL,             -- 'from' or 'to'
    action NVARCHAR(20) NOT NULL,                -- 'keep', 'delete'
    email NVARCHAR(255) NOT NULL,
    FOREIGN KEY (criteria_id) REFERENCES criteria(id) ON DELETE CASCADE
);
```

### Setup

```bash
# Start SQL Server
docker-compose up -d

# Run setup script
./scripts/db/setup.sh
```

See `scripts/db/README.md` for more details.

### Sync Utility

The server maintains both JSON and SQL as sources of truth. Use the sync script to manage them:

```bash
# Compare JSON and SQL data
npx tsx server/scripts/sync-criteria.ts compare

# Export SQL to JSON (backup)
npx tsx server/scripts/sync-criteria.ts export

# Import JSON to SQL (restore)
npx tsx server/scripts/sync-criteria.ts import
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_SQL_DATABASE` | `false` | Set to `true` to read from SQL Server (writes always go to both) |
| `DB_HOST` | `localhost` | SQL Server host |
| `DB_PORT` | `1433` | SQL Server port |
| `DB_NAME` | `GmailCriteria` | Database name |
| `DB_USER` | `sa` | Database user |
| `DB_PASSWORD` | `MyPass@word123` | Database password |

### Dual-Write Strategy

The server uses a **dual-write** approach:
- **Writes** always update **both** JSON and SQL to keep them in sync
- **Reads** use JSON by default (fast, sync), or SQL with `USE_SQL_DATABASE=true`
- This allows gradual migration without data loss
