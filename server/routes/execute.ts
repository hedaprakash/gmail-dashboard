/**
 * Execute Routes
 *
 * Handles email deletion execution using SQL Server pending_emails table.
 * All queries are scoped to the authenticated user.
 */

import { Router, Request, Response } from 'express';
import { queryAll, query } from '../services/database.js';
import { trashEmail } from '../services/gmail.js';
import { getUserEmail } from '../middleware/auth.js';

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
 * Scoped to authenticated user.
 */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const userEmail = getUserEmail(req);

    const summaryQuery = `
      SELECT
        ISNULL(Action, 'undecided') as action,
        COUNT(*) as count,
        MIN(EmailDate) as oldestDate,
        MAX(EmailDate) as newestDate
      FROM pending_emails
      WHERE user_email = @userEmail
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

    const summary = await queryAll<ActionSummary>(summaryQuery, { userEmail });

    // Also get total count for this user
    const totalResult = await queryAll<{ total: number }>(
      'SELECT COUNT(*) as total FROM pending_emails WHERE user_email = @userEmail',
      { userEmail }
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
 * Scoped to authenticated user.
 */
router.post('/preview', async (req: Request, res: Response) => {
  try {
    const { actionType = 'delete', minAgeDays = 0 } = req.body as ExecuteRequest;
    const userEmail = getUserEmail(req);

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - minAgeDays);

    // Query emails matching the action and age criteria for this user
    const matchQuery = `
      SELECT
        GmailId, FromEmail, Subject, EmailDate, MatchedRule
      FROM pending_emails
      WHERE user_email = @userEmail
        AND Action = @actionType
        AND EmailDate <= @cutoffDate
      ORDER BY EmailDate ASC
    `;

    const matches = await queryAll<{
      GmailId: string;
      FromEmail: string;
      Subject: string;
      EmailDate: Date;
      MatchedRule: string | null;
    }>(matchQuery, { userEmail, actionType, cutoffDate });

    // Query emails that would be skipped (too recent)
    const skippedQuery = `
      SELECT COUNT(*) as count
      FROM pending_emails
      WHERE user_email = @userEmail
        AND Action = @actionType
        AND EmailDate > @cutoffDate
    `;

    const skippedResult = await queryAll<{ count: number }>(
      skippedQuery,
      { userEmail, actionType, cutoffDate }
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
 * Scoped to authenticated user.
 */
router.post('/delete', async (req: Request, res: Response) => {
  try {
    const { actionType = 'delete', dryRun = true, minAgeDays = 0 } = req.body as ExecuteRequest;
    const userEmail = getUserEmail(req);

    console.log(`[${userEmail}] Executing delete: actionType=${actionType}, dryRun=${dryRun}, minAgeDays=${minAgeDays}`);

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - minAgeDays);

    // Get emails to delete for this user
    const emailsQuery = `
      SELECT Id, GmailId, FromEmail, Subject, EmailDate
      FROM pending_emails
      WHERE user_email = @userEmail
        AND Action = @actionType
        AND EmailDate <= @cutoffDate
      ORDER BY EmailDate ASC
    `;

    const emails = await queryAll<{
      Id: number;
      GmailId: string;
      FromEmail: string;
      Subject: string;
      EmailDate: Date;
    }>(emailsQuery, { userEmail, actionType, cutoffDate });

    // Get skipped count for this user
    const skippedQuery = `
      SELECT COUNT(*) as count
      FROM pending_emails
      WHERE user_email = @userEmail
        AND Action = @actionType
        AND EmailDate > @cutoffDate
    `;
    const skippedResult = await queryAll<{ count: number }>(
      skippedQuery,
      { userEmail, actionType, cutoffDate }
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
 * Scoped to authenticated user.
 */
router.post('/evaluate', async (req: Request, res: Response) => {
  try {
    const userEmail = getUserEmail(req);
    console.log(`[${userEmail}] Re-evaluating pending emails...`);

    // Reset all actions to NULL so they get re-evaluated (for this user only)
    await query(
      'UPDATE pending_emails SET Action = NULL, MatchedRule = NULL WHERE user_email = @userEmail',
      { userEmail }
    );

    // Call the stored procedure to evaluate pending emails
    // Note: EvaluatePendingEmails evaluates all emails, but results are user-scoped
    await query('EXEC dbo.EvaluatePendingEmails');

    // Get updated summary for this user
    const summaryQuery = `
      SELECT
        ISNULL(Action, 'undecided') as action,
        COUNT(*) as count
      FROM pending_emails
      WHERE user_email = @userEmail
      GROUP BY Action
    `;
    const summary = await queryAll<{ action: string; count: number }>(summaryQuery, { userEmail });

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
