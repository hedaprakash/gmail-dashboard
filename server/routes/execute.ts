/**
 * Execute Routes
 *
 * Handles email deletion execution using SQL Server pending_emails table.
 */

import { Router, Request, Response } from 'express';
import { queryAll, query } from '../services/database.js';
import { trashEmail } from '../services/gmail.js';

const router = Router();

// Types matching pending_emails table
interface PendingEmail {
  Id: number;
  GmailId: string;
  FromEmail: string;
  ToEmail: string;
  Subject: string;
  PrimaryDomain: string;
  Subdomain: string | null;
  EmailDate: Date;
  ReceivedAt: Date;
  Action: string | null;
  MatchedRule: string | null;
  ProcessedAt: Date | null;
}

interface ActionSummary {
  action: string;
  count: number;
  oldestDate: Date | null;
  newestDate: Date | null;
}

interface ExecuteRequest {
  actionType?: 'delete' | 'delete_1d' | 'delete_10d';
  dryRun?: boolean;
  minAgeDays?: number;
}

interface ExecuteProgress {
  total: number;
  processed: number;
  deleted: number;
  skipped: number;
  errors: number;
  logs: string[];
}

/**
 * GET /api/execute/summary
 * Get summary of pending emails by action type.
 */
router.get('/summary', async (_req: Request, res: Response) => {
  try {
    const summaryQuery = `
      SELECT
        ISNULL(Action, 'undecided') as action,
        COUNT(*) as count,
        MIN(EmailDate) as oldestDate,
        MAX(EmailDate) as newestDate
      FROM pending_emails
      GROUP BY Action
      ORDER BY
        CASE Action
          WHEN 'delete' THEN 1
          WHEN 'delete_1d' THEN 2
          WHEN 'delete_10d' THEN 3
          WHEN 'keep' THEN 4
          ELSE 5
        END
    `;

    const summary = await queryAll<ActionSummary>(summaryQuery);

    // Also get total count
    const totalResult = await queryAll<{ total: number }>(
      'SELECT COUNT(*) as total FROM pending_emails'
    );

    res.json({
      success: true,
      total: totalResult[0]?.total || 0,
      byAction: summary.map(s => ({
        action: s.action || 'undecided',
        count: s.count,
        oldestDate: s.oldestDate,
        newestDate: s.newestDate
      }))
    });
  } catch (error) {
    console.error('Error getting execute summary:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/execute/preview
 * Preview which emails would be deleted based on action type and age.
 */
router.post('/preview', async (req: Request, res: Response) => {
  try {
    const { actionType = 'delete', minAgeDays = 0 } = req.body as ExecuteRequest;

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - minAgeDays);

    // Query emails matching the action and age criteria
    const matchQuery = `
      SELECT
        GmailId, FromEmail, Subject, EmailDate, MatchedRule
      FROM pending_emails
      WHERE Action = @actionType
        AND EmailDate <= @cutoffDate
      ORDER BY EmailDate ASC
    `;

    const matches = await queryAll<{
      GmailId: string;
      FromEmail: string;
      Subject: string;
      EmailDate: Date;
      MatchedRule: string | null;
    }>(matchQuery, { actionType, cutoffDate });

    // Query emails that would be skipped (too recent)
    const skippedQuery = `
      SELECT COUNT(*) as count
      FROM pending_emails
      WHERE Action = @actionType
        AND EmailDate > @cutoffDate
    `;

    const skippedResult = await queryAll<{ count: number }>(
      skippedQuery,
      { actionType, cutoffDate }
    );

    res.json({
      success: true,
      actionType,
      minAgeDays,
      matchCount: matches.length,
      skippedCount: skippedResult[0]?.count || 0,
      matches: matches.slice(0, 100).map(m => ({
        id: m.GmailId,
        from: m.FromEmail,
        subject: m.Subject,
        date: m.EmailDate,
        matchedRule: m.MatchedRule
      }))
    });
  } catch (error) {
    console.error('Error previewing:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/execute/delete
 * Execute email deletion for specified action type.
 */
router.post('/delete', async (req: Request, res: Response) => {
  try {
    const { actionType = 'delete', dryRun = true, minAgeDays = 0 } = req.body as ExecuteRequest;

    console.log(`Executing delete: actionType=${actionType}, dryRun=${dryRun}, minAgeDays=${minAgeDays}`);

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - minAgeDays);

    // Get emails to delete
    const emailsQuery = `
      SELECT Id, GmailId, FromEmail, Subject, EmailDate
      FROM pending_emails
      WHERE Action = @actionType
        AND EmailDate <= @cutoffDate
      ORDER BY EmailDate ASC
    `;

    const emails = await queryAll<{
      Id: number;
      GmailId: string;
      FromEmail: string;
      Subject: string;
      EmailDate: Date;
    }>(emailsQuery, { actionType, cutoffDate });

    // Get skipped count
    const skippedQuery = `
      SELECT COUNT(*) as count
      FROM pending_emails
      WHERE Action = @actionType
        AND EmailDate > @cutoffDate
    `;
    const skippedResult = await queryAll<{ count: number }>(
      skippedQuery,
      { actionType, cutoffDate }
    );

    const progress: ExecuteProgress = {
      total: emails.length,
      processed: 0,
      deleted: 0,
      skipped: skippedResult[0]?.count || 0,
      errors: 0,
      logs: []
    };

    progress.logs.push(`Starting ${dryRun ? 'DRY RUN' : 'LIVE'} deletion for ${actionType}...`);
    progress.logs.push(`Found ${emails.length} emails to process (${progress.skipped} skipped as too recent)`);

    // Process deletions
    for (const email of emails) {
      progress.processed++;

      const truncatedSubject = email.Subject.length > 40
        ? email.Subject.slice(0, 40) + '...'
        : email.Subject;

      if (dryRun) {
        progress.deleted++;
        progress.logs.push(`[DRY-RUN] Would delete: ${email.FromEmail} - ${truncatedSubject}`);
      } else {
        try {
          const success = await trashEmail(email.GmailId);
          if (success) {
            progress.deleted++;
            progress.logs.push(`[DELETED] ${email.FromEmail} - ${truncatedSubject}`);

            // Remove from pending_emails after successful deletion
            await query(
              'DELETE FROM pending_emails WHERE Id = @id',
              { id: email.Id }
            );
          } else {
            progress.errors++;
            progress.logs.push(`[ERROR] Failed to delete: ${email.FromEmail} - ${truncatedSubject}`);
          }
        } catch (err) {
          progress.errors++;
          progress.logs.push(`[ERROR] ${err instanceof Error ? err.message : 'Unknown error'}: ${email.FromEmail}`);
        }
      }

      // Log progress every 10 emails
      if (progress.processed % 10 === 0) {
        console.log(`Progress: ${progress.processed}/${progress.total}`);
      }
    }

    progress.logs.push(`Completed: ${progress.deleted} deleted, ${progress.skipped} skipped (too recent), ${progress.errors} errors`);
    console.log(`Deletion complete: ${progress.deleted} deleted, ${progress.skipped} skipped, ${progress.errors} errors`);

    res.json({
      success: true,
      dryRun,
      actionType,
      summary: {
        total: progress.total,
        deleted: progress.deleted,
        skipped: progress.skipped,
        errors: progress.errors
      },
      progress: {
        logs: progress.logs
      }
    });
  } catch (error) {
    console.error('Error executing delete:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/execute/evaluate
 * Re-evaluate all pending emails using the stored procedure.
 */
router.post('/evaluate', async (_req: Request, res: Response) => {
  try {
    console.log('Re-evaluating pending emails...');

    // Call the stored procedure to evaluate pending emails
    await query('EXEC dbo.EvaluatePendingEmails');

    // Get updated summary
    const summaryQuery = `
      SELECT
        ISNULL(Action, 'undecided') as action,
        COUNT(*) as count
      FROM pending_emails
      GROUP BY Action
    `;
    const summary = await queryAll<{ action: string; count: number }>(summaryQuery);

    res.json({
      success: true,
      message: 'Emails re-evaluated successfully',
      summary: summary.reduce((acc, s) => {
        acc[s.action || 'undecided'] = s.count;
        return acc;
      }, {} as Record<string, number>)
    });
  } catch (error) {
    console.error('Error evaluating emails:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
