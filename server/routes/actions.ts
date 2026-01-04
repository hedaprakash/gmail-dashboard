/**
 * Action Routes - Unified Format
 *
 * Handles Keep/Delete/Delete1d button actions using the unified criteria format.
 */

import { Router, Request, Response } from 'express';
import {
  addRule,
  removeRule,
  addExcludeSubjects,
  markKeepAsync,
  getDomainCriteriaAsync,
  type Action
} from '../services/criteria.js';
import { logKeep, logDelete, logDelete1d, logDelete10d, logUndo } from '../services/actionLogger.js';

const router = Router();

/**
 * POST /api/actions/add-criteria
 * Add an entry for immediate deletion.
 */
router.post('/add-criteria', async (req: Request, res: Response) => {
  try {
    const { domain, subject_pattern, exclude_subject } = req.body;

    if (!domain) {
      res.status(400).json({
        success: false,
        error: 'Domain is required'
      });
      return;
    }

    // Handle exclude_subject - add to excludeSubjects list
    if (exclude_subject) {
      const terms = exclude_subject.split(',').map((t: string) => t.trim()).filter((t: string) => t);
      if (terms.length > 0) {
        addExcludeSubjects(domain, terms);
      }
    }

    // Add the delete rule
    addRule(domain, 'delete', subject_pattern || undefined);

    // Log the action
    logDelete(domain, subject_pattern || '');

    console.log(`Added delete rule: ${domain} (subject: ${subject_pattern || '(all)'})`);

    const rules = await getDomainCriteriaAsync(domain);

    res.json({
      success: true,
      message: subject_pattern ? `Added delete pattern for ${domain}` : `Set default delete for ${domain}`,
      domain,
      subjectPattern: subject_pattern,
      rules
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
 */
router.post('/add-criteria-1d', async (req: Request, res: Response) => {
  try {
    const { domain, subject_pattern, exclude_subject } = req.body;

    if (!domain) {
      res.status(400).json({
        success: false,
        error: 'Domain is required'
      });
      return;
    }

    // Handle exclude_subject - add to excludeSubjects list
    if (exclude_subject) {
      const terms = exclude_subject.split(',').map((t: string) => t.trim()).filter((t: string) => t);
      if (terms.length > 0) {
        addExcludeSubjects(domain, terms);
      }
    }

    // Add the delete_1d rule
    addRule(domain, 'delete_1d', subject_pattern || undefined);

    // Log the action
    logDelete1d(domain, subject_pattern || '');

    console.log(`Added delete_1d rule: ${domain} (subject: ${subject_pattern || '(all)'})`);

    const rules = await getDomainCriteriaAsync(domain);

    res.json({
      success: true,
      message: subject_pattern ? `Added delete_1d pattern for ${domain}` : `Set default delete_1d for ${domain}`,
      domain,
      subjectPattern: subject_pattern,
      rules
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
 */
router.post('/add-criteria-10d', async (req: Request, res: Response) => {
  try {
    const { domain, subject_pattern, exclude_subject } = req.body;

    if (!domain) {
      res.status(400).json({
        success: false,
        error: 'Domain is required'
      });
      return;
    }

    // Handle exclude_subject - add to excludeSubjects list
    if (exclude_subject) {
      const terms = exclude_subject.split(',').map((t: string) => t.trim()).filter((t: string) => t);
      if (terms.length > 0) {
        addExcludeSubjects(domain, terms);
      }
    }

    // Add the delete_10d rule
    addRule(domain, 'delete_10d', subject_pattern || undefined);

    // Log the action
    logDelete10d(domain, subject_pattern || '');

    console.log(`Added delete_10d rule: ${domain} (subject: ${subject_pattern || '(all)'})`);

    const rules = await getDomainCriteriaAsync(domain);

    res.json({
      success: true,
      message: subject_pattern ? `Added delete_10d pattern for ${domain}` : `Set default delete_10d for ${domain}`,
      domain,
      subjectPattern: subject_pattern,
      rules
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
 */
router.post('/mark-keep', async (req: Request, res: Response) => {
  try {
    const { domain, subject_pattern, category } = req.body;

    if (!domain) {
      res.status(400).json({
        success: false,
        error: 'Domain is required'
      });
      return;
    }

    // Use SQL-aware markKeepAsync function
    const { removedCount, rules } = await markKeepAsync(domain, subject_pattern || undefined);

    // Log the action
    logKeep(domain, subject_pattern || '', category, removedCount);

    console.log(`Marked keep: ${domain} (subject: ${subject_pattern || '(all)'}) - removed ${removedCount} delete rules`);

    res.json({
      success: true,
      message: subject_pattern
        ? `Added keep pattern for ${domain}`
        : `Set default keep for ${domain}`,
      domain,
      subjectPattern: subject_pattern,
      rules,
      removed_from_delete: removedCount
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
 * Undo the last action is not straightforward with unified format.
 * This endpoint is deprecated - use specific remove endpoints instead.
 */
router.post('/undo-last', (req: Request, res: Response) => {
  try {
    const { domain, action, subject_pattern } = req.body as {
      domain?: string;
      action?: Action;
      subject_pattern?: string;
    };

    if (!domain) {
      res.status(400).json({
        success: false,
        error: 'Domain is required for undo in unified format'
      });
      return;
    }

    const removed = removeRule(domain, action, subject_pattern);

    if (!removed) {
      res.status(404).json({
        success: false,
        error: 'Rule not found'
      });
      return;
    }

    // Log the undo action
    logUndo(domain, subject_pattern || '', action || 'unknown');

    console.log(`Undid rule: ${domain} ${action || ''} ${subject_pattern || ''}`);

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
 */
router.post('/set-default', async (req: Request, res: Response) => {
  try {
    const { domain, action } = req.body as {
      domain: string;
      action: Action;
    };

    if (!domain) {
      res.status(400).json({
        success: false,
        error: 'Domain is required'
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

    addRule(domain, action);

    console.log(`Set default ${action} for ${domain}`);

    const rules = await getDomainCriteriaAsync(domain);

    res.json({
      success: true,
      message: `Set default ${action} for ${domain}`,
      domain,
      action,
      rules
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
 */
router.post('/add-pattern', async (req: Request, res: Response) => {
  try {
    const { domain, action, pattern } = req.body as {
      domain: string;
      action: Action;
      pattern: string;
    };

    if (!domain || !pattern) {
      res.status(400).json({
        success: false,
        error: 'Domain and pattern are required'
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

    addRule(domain, action, pattern);

    console.log(`Added ${action} pattern for ${domain}: "${pattern}"`);

    const rules = await getDomainCriteriaAsync(domain);

    res.json({
      success: true,
      message: `Added ${action} pattern for ${domain}`,
      domain,
      action,
      pattern,
      rules
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
