# Empty Spam Folder Workflow

## Overview

Permanently delete all emails from Gmail's Spam folder.

## Gmail Query

```
in:spam
```

This targets all emails in the Spam folder, regardless of read status.

## API Endpoint

```
POST /api/execute/empty-spam
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
  "message": "Found 156 spam emails",
  "result": {
    "count": 156,
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
  "message": "Deleted 156 spam emails",
  "result": {
    "count": 156,
    "deleted": 156,
    "errors": 0
  }
}
```

## UI Location

**Execute Page** → **Quick Actions** section → **Empty Spam Folder** card

### Available Actions

1. **Preview Count** - Shows how many spam emails exist (dry run)
2. **Empty Spam** - Permanently deletes all spam emails

## Code References

| Component | File | Function/Route |
|-----------|------|----------------|
| Service function | `server/services/gmail.ts:408` | `emptySpamFolder()` |
| API route | `server/routes/execute.ts:385` | `POST /empty-spam` |
| UI component | `src/pages/Execute.tsx` | Quick Actions section |

## Technical Details

### How It Works

1. Uses Gmail API `users.messages.list()` with `in:spam` query
2. Paginates through all spam messages (500 per batch)
3. Uses `users.messages.batchDelete()` for efficient bulk deletion
4. Falls back to individual `users.messages.delete()` if batch fails
5. Returns count of processed/deleted/errors

### Deletion Method

Uses **permanent deletion** (`batchDelete` / `delete`) rather than `trash`. Spam emails are already unwanted, so they are removed completely without going to Trash.

> **Warning**: This action is irreversible. Emails deleted this way cannot be recovered.

### Batch Delete Optimization

Unlike promotional email deletion (which uses `trash`), spam deletion uses `batchDelete` which can process up to 1000 message IDs per API call, making it significantly faster for large spam folders.

### Rate Limits

- Gmail API quota: 250 quota units per user per second
- `messages.list`: 5 units per call
- `messages.batchDelete`: 50 units per call
- Batch operations are more efficient than individual deletions

## Usage Examples

### CLI (curl)

```bash
# Preview count
curl -X POST http://localhost:5000/api/execute/empty-spam \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'

# Execute deletion (PERMANENT - cannot be undone)
curl -X POST http://localhost:5000/api/execute/empty-spam \
  -H "Content-Type: application/json" \
  -d '{"dryRun": false}'
```

### From UI

1. Navigate to http://localhost:3000/execute
2. Scroll to "Quick Actions" section
3. Click "Preview Count" to see spam email count
4. Click "Empty Spam" to permanently delete

## Safety Considerations

1. **Always preview first** - Use dry run to see count before deleting
2. **Permanent deletion** - Unlike trash, these emails cannot be recovered
3. **Gmail already filters** - Gmail's spam detection is generally accurate, but review if unsure

## Related

- [Delete Promotional Emails](./delete-promotional-emails.md)
- Gmail Spam settings: https://support.google.com/mail/answer/1366858
