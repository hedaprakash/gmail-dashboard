/**
 * Action Routes - Unified Format with Multi-User Support
 *
 * Handles Keep/Delete/Delete1d button actions using the unified criteria format.
 * All actions are scoped to the authenticated user.
 */

import { Router, Request, Response } from 'express';
import {
  removeRule,
  addRuleAsync,
  type Action
} from '../services/criteria.js';
import { logKeep, logDelete, logDelete1d, logDelete10d, logUndo } from '../services/actionLogger.js';
import { getUserEmail } from '../middleware/auth.js';

const router = Router();

/**
 * POST /api/actions/add-criteria
 * Add an entry for immediate deletion.
 * NEW: Accepts raw email fields (fromEmail, toEmail, subject) and level.
 */
router.post('/add-criteria', async (req: Request, res: Response) => {
  try {
    const { fromEmail, toEmail, subject, level, subject_pattern } = req.body;
    const userEmail = getUserEmail(req);

    if (!fromEmail) {
      res.status(400).json({
        success: false,
        error: 'fromEmail is required'
      });
      return;
    }

    // Add the delete rule using raw email fields
    const result = await addRuleAsync({
      fromEmail,
      toEmail: toEmail || userEmail,
      subject: subject || '',
      action: 'delete',
      level: level || 'domain',
      userEmail,
      subjectPattern: subject_pattern || undefined
    });

    // Log the action - use raw fromEmail, no parsing
    logDelete(fromEmail, subject_pattern || '');

    console.log(`[${userEmail}] Added delete rule: ${fromEmail} (subject: ${subject_pattern || '(all)'})`);

    res.json({
      success: true,
      message: result.message,
      fromEmail,
      subjectPattern: subject_pattern,
      criteriaId: result.criteriaId
    });
  } catch (error) {
    console.error('Error adding criteria:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/actions/add-criteria-1d
 * Add an entry for deletion after 1 day.
 * NEW: Accepts raw email fields (fromEmail, toEmail, subject) and level.
 */
router.post('/add-criteria-1d', async (req: Request, res: Response) => {
  try {
    const { fromEmail, toEmail, subject, level, subject_pattern } = req.body;
    const userEmail = getUserEmail(req);

    if (!fromEmail) {
      res.status(400).json({
        success: false,
        error: 'fromEmail is required'
      });
      return;
    }

    // Add the delete_1d rule using raw email fields
    const result = await addRuleAsync({
      fromEmail,
      toEmail: toEmail || userEmail,
      subject: subject || '',
      action: 'delete_1d',
      level: level || 'domain',
      userEmail,
      subjectPattern: subject_pattern || undefined
    });

    // Log the action - use raw fromEmail, no parsing
    logDelete1d(fromEmail, subject_pattern || '');

    console.log(`[${userEmail}] Added delete_1d rule: ${fromEmail} (subject: ${subject_pattern || '(all)'})`);

    res.json({
      success: true,
      message: result.message,
      fromEmail,
      subjectPattern: subject_pattern,
      criteriaId: result.criteriaId
    });
  } catch (error) {
    console.error('Error adding 1-day criteria:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/actions/add-criteria-10d
 * Add an entry for deletion after 10 days.
 * NEW: Accepts raw email fields (fromEmail, toEmail, subject) and level.
 */
router.post('/add-criteria-10d', async (req: Request, res: Response) => {
  try {
    const { fromEmail, toEmail, subject, level, subject_pattern } = req.body;
    const userEmail = getUserEmail(req);

    if (!fromEmail) {
      res.status(400).json({
        success: false,
        error: 'fromEmail is required'
      });
      return;
    }

    // Add the delete_10d rule using raw email fields
    const result = await addRuleAsync({
      fromEmail,
      toEmail: toEmail || userEmail,
      subject: subject || '',
      action: 'delete_10d',
      level: level || 'domain',
      userEmail,
      subjectPattern: subject_pattern || undefined
    });

    // Log the action - use raw fromEmail, no parsing
    logDelete10d(fromEmail, subject_pattern || '');

    console.log(`[${userEmail}] Added delete_10d rule: ${fromEmail} (subject: ${subject_pattern || '(all)'})`);

    res.json({
      success: true,
      message: result.message,
      fromEmail,
      subjectPattern: subject_pattern,
      criteriaId: result.criteriaId
    });
  } catch (error) {
    console.error('Error adding 10-day criteria:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/actions/mark-keep
 * Mark an email pattern as 'keep' - removes from delete criteria AND adds to keep.
 * Accepts fromEmail (raw) - SQL extracts domain.
 */
router.post('/mark-keep', async (req: Request, res: Response) => {
  try {
    const { fromEmail, subject_pattern, category } = req.body;
    const userEmail = getUserEmail(req);

    if (!fromEmail) {
      res.status(400).json({
        success: false,
        error: 'fromEmail is required'
      });
      return;
    }

    // Call addRuleAsync with action='keep' - SQL extracts domain from fromEmail
    const result = await addRuleAsync({
      fromEmail,
      toEmail: userEmail,
      subject: '',
      action: 'keep',
      level: 'domain',
      userEmail,
      subjectPattern: subject_pattern || undefined
    });

    // Log the action - use raw fromEmail, no parsing
    logKeep(fromEmail, subject_pattern || '', category, 0);

    console.log(`[${userEmail}] Marked keep: ${fromEmail} (subject: ${subject_pattern || '(all)'})`);

    res.json({
      success: true,
      message: result.message,
      fromEmail,
      subjectPattern: subject_pattern,
      criteriaId: result.criteriaId
    });
  } catch (error) {
    console.error('Error marking keep:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/actions/undo-last
 * Remove a previously added rule.
 * Supports domain, subdomain, pattern, fromEmail, and toEmail rules.
 */
router.post('/undo-last', (req: Request, res: Response) => {
  try {
    const { domain, action, subject_pattern, subdomain, fromEmail, toEmail } = req.body as {
      domain?: string;
      action?: Action;
      subject_pattern?: string;
      subdomain?: string;
      fromEmail?: string;
      toEmail?: string;
    };
    const userEmail = getUserEmail(req);

    if (!domain) {
      res.status(400).json({
        success: false,
        error: 'Domain is required for undo'
      });
      return;
    }

    const removed = removeRule(domain, action, subject_pattern, subdomain, userEmail);

    if (!removed) {
      res.status(404).json({
        success: false,
        error: 'Rule not found'
      });
      return;
    }

    // Log the undo action
    logUndo(domain, subject_pattern || '', action || 'unknown');

    console.log(`[${userEmail}] Undid rule: ${domain} ${action || ''} ${subject_pattern || ''}`);

    res.json({
      success: true,
      message: 'Rule removed',
      domain,
      action,
      subject_pattern
    });
  } catch (error) {
    console.error('Error undoing:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/actions/set-default
 * Set the default action for a domain.
 * NEW: Accepts raw email fields (fromEmail, toEmail, subject) and level.
 */
router.post('/set-default', async (req: Request, res: Response) => {
  try {
    const { fromEmail, toEmail, subject, level, action } = req.body as {
      fromEmail: string;
      toEmail?: string;
      subject?: string;
      level?: 'domain' | 'subdomain' | 'from_email' | 'to_email';
      action: Action;
    };
    const userEmail = getUserEmail(req);

    if (!fromEmail) {
      res.status(400).json({
        success: false,
        error: 'fromEmail is required'
      });
      return;
    }

    if (!action || !['delete', 'delete_1d', 'delete_10d', 'keep'].includes(action)) {
      res.status(400).json({
        success: false,
        error: 'Valid action is required (delete, delete_1d, delete_10d, keep)'
      });
      return;
    }

    const result = await addRuleAsync({
      fromEmail,
      toEmail: toEmail || userEmail,
      subject: subject || '',
      action,
      level: level || 'domain',
      userEmail
    });

    console.log(`[${userEmail}] Set default ${action} for ${fromEmail}`);

    res.json({
      success: true,
      message: result.message,
      fromEmail,
      action,
      criteriaId: result.criteriaId
    });
  } catch (error) {
    console.error('Error setting default:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/actions/add-pattern
 * Add a subject pattern for a specific action.
 * NEW: Accepts raw email fields (fromEmail, toEmail, subject) and level.
 */
router.post('/add-pattern', async (req: Request, res: Response) => {
  try {
    const { fromEmail, toEmail, subject, level, action, pattern } = req.body as {
      fromEmail: string;
      toEmail?: string;
      subject?: string;
      level?: 'domain' | 'subdomain' | 'from_email' | 'to_email';
      action: Action;
      pattern: string;
    };
    const userEmail = getUserEmail(req);

    if (!fromEmail || !pattern) {
      res.status(400).json({
        success: false,
        error: 'fromEmail and pattern are required'
      });
      return;
    }

    if (!action || !['delete', 'delete_1d', 'delete_10d', 'keep'].includes(action)) {
      res.status(400).json({
        success: false,
        error: 'Valid action is required (delete, delete_1d, delete_10d, keep)'
      });
      return;
    }

    const result = await addRuleAsync({
      fromEmail,
      toEmail: toEmail || userEmail,
      subject: subject || '',
      action,
      level: level || 'domain',
      userEmail,
      subjectPattern: pattern
    });

    console.log(`[${userEmail}] Added ${action} pattern for ${fromEmail}: "${pattern}"`);

    res.json({
      success: true,
      message: result.message,
      fromEmail,
      action,
      pattern,
      criteriaId: result.criteriaId
    });
  } catch (error) {
    console.error('Error adding pattern:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
