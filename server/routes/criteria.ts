/**
 * Criteria Routes - Unified Format with Multi-User Support
 *
 * API endpoints for managing the unified criteria file.
 * All criteria are scoped to the authenticated user.
 */

import { Router, Request, Response } from 'express';
import {
  loadUnifiedCriteriaAsync,
  removeRule,
  addExcludeSubjects,
  getDomainCriteriaAsync,
  getCriteriaStatsAsync,
  invalidateCache,
  updateDomainRulesAsync,
  deleteDomainAsync,
  addRuleAsync,
  type Action,
  type DomainRules,
  type UnifiedCriteria
} from '../services/criteria.js';
import { getUserEmail } from '../middleware/auth.js';
import { query } from '../services/database.js';

/**
 * Request body for the unified /modify endpoint
 */
interface CriteriaModifyRequest {
  operation: 'ADD' | 'REMOVE' | 'UPDATE' | 'CLEAR' | 'GET';
  dimension: 'domain' | 'subdomain' | 'email' | 'subject' | 'from_email' | 'to_email';
  action?: 'delete' | 'delete_1d' | 'delete_10d' | 'keep';
  keyValue?: string;
  parentDomain?: string;
  parentSubdomain?: string;
  oldAction?: string;
}

/**
 * Response from the ModifyCriteria stored procedure
 */
interface ModifyCriteriaResult {
  Success: number;
  Message: string;
  RecordId: number | null;
  AuditId: number | null;
}

const router = Router();

/**
 * POST /api/criteria/modify
 * Unified endpoint for all criteria modifications.
 * Calls the ModifyCriteria stored procedure directly.
 *
 * Body: CriteriaModifyRequest
 */
router.post('/modify', async (req: Request, res: Response) => {
  try {
    const userEmail = getUserEmail(req);
    const {
      operation,
      dimension,
      action,
      keyValue,
      parentDomain,
      parentSubdomain,
      oldAction
    } = req.body as CriteriaModifyRequest;

    // Validate required fields
    if (!operation) {
      res.status(400).json({
        success: false,
        error: 'Operation is required (ADD, REMOVE, UPDATE, CLEAR, GET)'
      });
      return;
    }

    if (!dimension) {
      res.status(400).json({
        success: false,
        error: 'Dimension is required (domain, subdomain, email, subject, from_email, to_email)'
      });
      return;
    }

    // Validate action for ADD/UPDATE operations
    if (['ADD', 'UPDATE'].includes(operation.toUpperCase()) && !action) {
      res.status(400).json({
        success: false,
        error: 'Action is required for ADD/UPDATE operations (delete, delete_1d, delete_10d, keep)'
      });
      return;
    }

    // Call the stored procedure
    const result = await query<ModifyCriteriaResult>(
      `EXEC dbo.ModifyCriteria
        @Operation = @operation,
        @Dimension = @dimension,
        @Action = @action,
        @KeyValue = @keyValue,
        @UserEmail = @userEmail,
        @ParentDomain = @parentDomain,
        @ParentSubdomain = @parentSubdomain,
        @OldAction = @oldAction`,
      {
        operation: operation.toUpperCase(),
        dimension: dimension.toLowerCase(),
        action: action?.toLowerCase() || null,
        keyValue: keyValue?.toLowerCase() || null,
        userEmail,
        parentDomain: parentDomain?.toLowerCase() || null,
        parentSubdomain: parentSubdomain?.toLowerCase() || null,
        oldAction: oldAction?.toLowerCase() || null
      }
    );

    const row = result.recordset[0];

    if (!row) {
      res.status(500).json({
        success: false,
        error: 'No response from stored procedure'
      });
      return;
    }

    const success = row.Success === 1;

    // Invalidate cache after successful modification
    if (success && operation.toUpperCase() !== 'GET') {
      invalidateCache();
    }

    // Log the operation
    console.log(`[${userEmail}] ${operation} ${dimension}: ${row.Message}`);

    // Return response
    res.json({
      success,
      message: row.Message,
      recordId: row.RecordId,
      auditId: row.AuditId
    });

    // For GET operations, additional data may be in subsequent result sets
    // The stored procedure returns additional result sets for GET operations
    // but Express has already sent the response, so we can't include them here
    // Future enhancement: handle multiple result sets for GET operations

  } catch (error) {
    console.error('Error in /modify endpoint:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/criteria
 * Get the entire unified criteria file for the current user.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userEmail = getUserEmail(req);
    const criteria = await loadUnifiedCriteriaAsync(userEmail);
    const stats = await getCriteriaStatsAsync(userEmail);

    res.json({
      success: true,
      criteria,
      stats
    });
  } catch (error) {
    console.error('Error loading criteria:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/criteria/stats
 * Get statistics about the criteria for the current user.
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const userEmail = getUserEmail(req);
    const stats = await getCriteriaStatsAsync(userEmail);
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/criteria/domain/:domain
 * Get criteria for a specific domain for the current user.
 */
router.get('/domain/:domain', async (req: Request, res: Response) => {
  try {
    const userEmail = getUserEmail(req);
    const domain = req.params.domain;
    const rules = await getDomainCriteriaAsync(domain, userEmail);

    if (!rules) {
      res.status(404).json({
        success: false,
        error: 'Domain not found in criteria'
      });
      return;
    }

    res.json({
      success: true,
      domain,
      rules
    });
  } catch (error) {
    console.error('Error getting domain criteria:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/criteria/rule
 * Add a new rule to the criteria for the current user.
 *
 * Body: { domain, action, subjectPattern?, subdomain? }
 */
router.post('/rule', async (req: Request, res: Response) => {
  try {
    const userEmail = getUserEmail(req);
    const { domain, action, subjectPattern, subdomain } = req.body as {
      domain: string;
      action: Action;
      subjectPattern?: string;
      subdomain?: string;
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

    await addRuleAsync(domain, action, userEmail, subjectPattern, subdomain);

    const message = subjectPattern
      ? `Added ${action} rule for ${domain}: "${subjectPattern}"`
      : `Set default ${action} for ${domain}`;

    console.log(`[${userEmail}] ${message}`);

    res.json({
      success: true,
      message,
      domain,
      action,
      subjectPattern,
      subdomain
    });
  } catch (error) {
    console.error('Error adding rule:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * DELETE /api/criteria/rule
 * Remove a rule from the criteria for the current user.
 *
 * Body: { domain, action?, subjectPattern?, subdomain? }
 */
router.delete('/rule', (req: Request, res: Response) => {
  try {
    const userEmail = getUserEmail(req);
    const { domain, action, subjectPattern, subdomain } = req.body as {
      domain: string;
      action?: Action;
      subjectPattern?: string;
      subdomain?: string;
    };

    if (!domain) {
      res.status(400).json({
        success: false,
        error: 'Domain is required'
      });
      return;
    }

    const removed = removeRule(domain, action, subjectPattern, subdomain, userEmail);

    if (!removed) {
      res.status(404).json({
        success: false,
        error: 'Rule not found'
      });
      return;
    }

    const message = subjectPattern
      ? `Removed ${action} rule for ${domain}: "${subjectPattern}"`
      : action
        ? `Removed ${action} rules for ${domain}`
        : `Removed all rules for ${domain}`;

    console.log(message);

    res.json({
      success: true,
      message
    });
  } catch (error) {
    console.error('Error removing rule:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * PUT /api/criteria/domain/:domain
 * Update all rules for a domain.
 *
 * Body: DomainRules object
 */
router.put('/domain/:domain', async (req: Request, res: Response) => {
  try {
    const domain = req.params.domain.toLowerCase();
    const rules = req.body as DomainRules;

    await updateDomainRulesAsync(domain, rules);

    console.log(`Updated rules for ${domain}`);

    res.json({
      success: true,
      message: `Updated rules for ${domain}`,
      domain,
      rules
    });
  } catch (error) {
    console.error('Error updating domain:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * DELETE /api/criteria/domain/:domain
 * Remove all rules for a domain.
 */
router.delete('/domain/:domain', async (req: Request, res: Response) => {
  try {
    const domain = req.params.domain.toLowerCase();

    const deleted = await deleteDomainAsync(domain);

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: 'Domain not found'
      });
      return;
    }

    console.log(`Removed all rules for ${domain}`);

    res.json({
      success: true,
      message: `Removed all rules for ${domain}`
    });
  } catch (error) {
    console.error('Error deleting domain:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/criteria/exclude
 * Add exclude subjects to a domain.
 *
 * Body: { domain, terms: string[] }
 */
router.post('/exclude', (req: Request, res: Response) => {
  try {
    const { domain, terms } = req.body as {
      domain: string;
      terms: string[];
    };

    if (!domain || !terms?.length) {
      res.status(400).json({
        success: false,
        error: 'Domain and terms are required'
      });
      return;
    }

    addExcludeSubjects(domain, terms);

    console.log(`Added exclude subjects to ${domain}: ${terms.join(', ')}`);

    res.json({
      success: true,
      message: `Added exclude subjects to ${domain}`,
      domain,
      terms
    });
  } catch (error) {
    console.error('Error adding exclude subjects:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/criteria/refresh
 * Invalidate the criteria cache.
 */
router.post('/refresh', (_req: Request, res: Response) => {
  try {
    invalidateCache();
    res.json({
      success: true,
      message: 'Cache invalidated'
    });
  } catch (error) {
    console.error('Error refreshing cache:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/criteria/search
 * Search for domains matching a pattern for the current user.
 */
router.get('/search', async (req: Request, res: Response) => {
  try {
    const userEmail = getUserEmail(req);
    const query = (req.query.q as string || '').toLowerCase();

    if (!query) {
      res.status(400).json({
        success: false,
        error: 'Query parameter q is required'
      });
      return;
    }

    const criteria = await loadUnifiedCriteriaAsync(userEmail);
    const matches: { domain: string; rules: DomainRules }[] = [];

    for (const [domain, rules] of Object.entries(criteria)) {
      if (domain.includes(query)) {
        matches.push({ domain, rules });
      }
    }

    res.json({
      success: true,
      query,
      count: matches.length,
      matches
    });
  } catch (error) {
    console.error('Error searching criteria:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
