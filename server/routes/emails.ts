/**
 * Email Routes
 *
 * Handles fetching and displaying emails from SQL Server.
 */

import { Router, Request, Response } from 'express';
import sql from 'mssql';
import { fetchAllUnreadEmails, getGmailUrl } from '../services/gmail.js';
import { getCriteriaStats } from '../services/criteria.js';
import { query, queryAll, getPool } from '../services/database.js';
import { classifyEmail } from '../services/classification.js';
import { groupEmailsByPattern, saveCachedEmails } from '../services/cache.js';
import type { EmailData } from '../types/index.js';

const router = Router();

// SQL row type for pending_emails
interface PendingEmailRow {
  Id: number;
  GmailId: string;
  FromEmail: string | null;
  ToEmail: string | null;
  Subject: string | null;
  PrimaryDomain: string | null;
  Subdomain: string | null;
  EmailDate: Date | null;
  ReceivedAt: Date;
  Action: string | null;
  MatchedRule: string | null;
}

/**
 * Convert SQL row to EmailData format with classification
 */
function sqlRowToEmailData(row: PendingEmailRow): EmailData {
  const subject = row.Subject || '(no subject)';
  const classification = classifyEmail(subject);

  return {
    id: row.GmailId,
    email: row.FromEmail || '',
    from: row.FromEmail || '',
    subdomain: row.Subdomain || row.PrimaryDomain || '',
    primaryDomain: row.PrimaryDomain || '',
    subject: subject,
    toEmails: row.ToEmail || '',
    ccEmails: '',
    date: row.EmailDate?.toISOString() || new Date().toISOString(),
    category: classification.category,
    categoryIcon: classification.icon,
    categoryColor: classification.color,
    categoryBg: classification.bgColor,
    matchedKeyword: classification.matchedKeyword
  };
}

/**
 * GET /api/emails
 * Load undecided emails from SQL Server, grouped by domain/pattern.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    // Get count of all pending emails
    const totalResult = await queryAll<{ count: number }>(
      'SELECT COUNT(*) as count FROM pending_emails'
    );
    const totalEmails = totalResult[0]?.count || 0;

    if (totalEmails === 0) {
      res.status(404).json({
        success: false,
        error: 'No emails found. Click "Refresh from Gmail" to fetch emails.'
      });
      return;
    }

    // Get undecided emails only (for review)
    const rows = await queryAll<PendingEmailRow>(
      `SELECT * FROM pending_emails
       WHERE Action = 'undecided' OR Action IS NULL
       ORDER BY EmailDate DESC`
    );

    // Convert to EmailData format
    const emails: EmailData[] = rows.map(sqlRowToEmailData);

    // Get count of filtered (non-undecided) emails
    const decidedResult = await queryAll<{ count: number }>(
      `SELECT COUNT(*) as count FROM pending_emails
       WHERE Action IS NOT NULL AND Action != 'undecided'`
    );
    const filteredOut = decidedResult[0]?.count || 0;

    // Group by domain and pattern
    const grouped = groupEmailsByPattern(emails);

    // Add Gmail URLs to each pattern
    for (const domainGroup of grouped) {
      for (const pattern of domainGroup.patterns) {
        (pattern as any).gmailUrl = getGmailUrl(
          pattern.messageIds,
          pattern.domain,
          pattern.subject
        );
      }
    }

    res.json({
      success: true,
      source: 'SQL Server',
      totalEmails,
      filteredOut,
      undecidedEmails: emails.length,
      domains: grouped
    });
  } catch (error) {
    console.error('Error loading emails:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/emails/refresh
 * Refresh emails from Gmail API and sync to SQL Server.
 */
router.post('/refresh', async (_req: Request, res: Response) => {
  try {
    console.log('Refreshing emails from Gmail API...');

    const emails = await fetchAllUnreadEmails((count) => {
      console.log(`Progress: ${count} emails processed`);
    });

    // Save to JSON as backup only
    saveCachedEmails(emails);

    // Sync to SQL Server
    console.log('Syncing to SQL Server...');

    // Clear existing pending emails
    await query('TRUNCATE TABLE pending_emails');
    console.log('Cleared pending_emails table');

    // Bulk insert emails (column sizes must match table schema exactly)
    const pool = await getPool();
    const table = new sql.Table('pending_emails');
    table.create = false;
    // Match exact schema: Id is auto-increment so we skip it
    table.columns.add('GmailId', sql.NVarChar(100), { nullable: true });
    table.columns.add('FromEmail', sql.NVarChar(255), { nullable: true });
    table.columns.add('ToEmail', sql.NVarChar(255), { nullable: true });
    table.columns.add('Subject', sql.NVarChar(500), { nullable: true });
    table.columns.add('PrimaryDomain', sql.NVarChar(255), { nullable: true });
    table.columns.add('Subdomain', sql.NVarChar(255), { nullable: true });
    table.columns.add('EmailDate', sql.DateTime, { nullable: true });
    table.columns.add('ReceivedAt', sql.DateTime, { nullable: true });
    table.columns.add('Action', sql.NVarChar(20), { nullable: true });

    for (const email of emails) {
      // Truncate fields to fit column sizes
      const fromEmail = (email.from || '').slice(0, 255) || null;
      const toEmail = (email.to || '').slice(0, 255) || null;
      const subject = (email.subject || '').slice(0, 500) || null;

      table.rows.add(
        email.id,
        fromEmail,
        toEmail,
        subject,
        email.primaryDomain || null,
        email.subdomain || null,
        email.date ? new Date(email.date) : null,
        new Date(),
        null // Action will be set by evaluation
      );
    }

    const request = pool.request();
    await request.bulk(table);
    console.log(`Inserted ${emails.length} emails into pending_emails`);

    // Run evaluation
    console.log('Re-evaluating pending emails...');
    await query('EXEC dbo.EvaluatePendingEmails');
    console.log('Evaluation complete');

    res.json({
      success: true,
      message: `Fetched ${emails.length} emails from Gmail`,
      totalEmails: emails.length
    });
  } catch (error) {
    console.error('Error refreshing emails:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/emails/stats
 * Get email statistics from SQL Server.
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    // Get counts by action
    const actionCounts = await queryAll<{ Action: string | null; count: number }>(
      `SELECT Action, COUNT(*) as count FROM pending_emails GROUP BY Action`
    );

    const total = actionCounts.reduce((sum, row) => sum + row.count, 0);

    if (total === 0) {
      res.json({
        success: true,
        hasCached: false,
        message: 'No emails in database. Click refresh to fetch.'
      });
      return;
    }

    // Build stats from action counts
    let matchedDelete = 0;
    let matchedDelete1d = 0;
    let matchedDelete10d = 0;
    let matchedKeep = 0;
    let undecided = 0;

    for (const row of actionCounts) {
      switch (row.Action) {
        case 'delete':
          matchedDelete = row.count;
          break;
        case 'delete_1d':
          matchedDelete1d = row.count;
          break;
        case 'delete_10d':
          matchedDelete10d = row.count;
          break;
        case 'keep':
          matchedKeep = row.count;
          break;
        default:
          undecided += row.count;
      }
    }

    // Get domain breakdowns for each action type
    const deleteDomains = await queryAll<{ PrimaryDomain: string; count: number }>(
      `SELECT PrimaryDomain, COUNT(*) as count FROM pending_emails
       WHERE Action = 'delete' GROUP BY PrimaryDomain ORDER BY count DESC`
    );
    const delete1dDomains = await queryAll<{ PrimaryDomain: string; count: number }>(
      `SELECT PrimaryDomain, COUNT(*) as count FROM pending_emails
       WHERE Action = 'delete_1d' GROUP BY PrimaryDomain ORDER BY count DESC`
    );
    const keepDomains = await queryAll<{ PrimaryDomain: string; count: number }>(
      `SELECT PrimaryDomain, COUNT(*) as count FROM pending_emails
       WHERE Action = 'keep' GROUP BY PrimaryDomain ORDER BY count DESC`
    );

    // Convert to object format and limit to top 10
    const toObject = (rows: { PrimaryDomain: string; count: number }[]) =>
      rows.slice(0, 10).reduce((acc, row) => ({ ...acc, [row.PrimaryDomain || 'unknown']: row.count }), {});

    // Get criteria stats
    const criteriaStats = getCriteriaStats();

    res.json({
      success: true,
      source: 'SQL Server',
      stats: {
        total,
        matchedDelete,
        matchedDelete1d,
        matchedDelete10d,
        matchedKeep,
        undecided,
        deleteDomains: toObject(deleteDomains),
        delete1dDomains: toObject(delete1dDomains),
        keepDomains: toObject(keepDomains)
      },
      criteriaStats
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
