# Delete Promotional Emails Workflow

## Overview

Delete all unread promotional and social emails from Gmail using Gmail's built-in category labels.

## Gmail Query

```
category:promotions OR category:social is:unread
```

This targets emails that Gmail has automatically categorized into:
- **Promotions** tab - Marketing emails, deals, offers
- **Social** tab - Social network notifications (Facebook, LinkedIn, Twitter, etc.)

## API Endpoint

```
POST /api/execute/delete-promotions
```

### Request Body

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dryRun` | boolean | `true` | Preview only (no deletion) when true |

### Response

```json
{
  "success": true,
  "dryRun": true,
  "message": "Found 42 promotional/social emails",
  "result": {
    "count": 42,
    "deleted": 0,
    "errors": 0
  }
}
```

When `dryRun: false`:
```json
{
  "success": true,
  "dryRun": false,
  "message": "Deleted 42 promotional/social emails",
  "result": {
    "count": 42,
    "deleted": 42,
    "errors": 0
  }
}
```

## UI Location

**Execute Page** → **Quick Actions** section → **Delete Promotions & Social** card

### Available Actions

1. **Preview Count** - Shows how many emails match (dry run)
2. **Delete All** - Permanently moves matching emails to trash

## Code References

| Component | File | Function/Route |
|-----------|------|----------------|
| Service function | `server/services/gmail.ts:352` | `deletePromotionalEmails()` |
| API route | `server/routes/execute.ts:355` | `POST /delete-promotions` |
| UI component | `src/pages/Execute.tsx` | Quick Actions section |

## Technical Details

### How It Works

1. Uses Gmail API `users.messages.list()` with category query
2. Paginates through all matching messages (500 per batch)
3. Moves each message to trash via `users.messages.trash()`
4. Returns count of processed/deleted/errors

### Rate Limits

- Gmail API quota: 250 quota units per user per second
- `messages.list`: 5 units per call
- `messages.trash`: 50 units per call
- Large volumes may take time due to per-message trash calls

### Deletion Method

Uses `trash` (recoverable for 30 days) rather than `delete` (permanent). Users can recover accidentally deleted emails from Gmail's Trash folder.

## Usage Examples

### CLI (curl)

```bash
# Preview count
curl -X POST http://localhost:5000/api/execute/delete-promotions \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'

# Execute deletion
curl -X POST http://localhost:5000/api/execute/delete-promotions \
  -H "Content-Type: application/json" \
  -d '{"dryRun": false}'
```

### From UI

1. Navigate to http://localhost:3000/execute
2. Scroll to "Quick Actions" section
3. Click "Preview Count" to see affected email count
4. Click "Delete All" to execute

## Related

- [Empty Spam Folder](./empty-spam-folder.md)
- Gmail Categories: https://support.google.com/mail/answer/3094499
