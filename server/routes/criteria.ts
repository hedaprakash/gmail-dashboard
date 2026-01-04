/**
 * Criteria Routes - Unified Format
 *
 * API endpoints for managing the unified criteria file.
 */

import { Router, Request, Response } from 'express';
import {
  loadUnifiedCriteria,
  saveUnifiedCriteria,
  addRule,
  removeRule,
  addExcludeSubjects,
  getDomainCriteria,
  getCriteriaStats,
  invalidateCache,
  type Action,
  type DomainRules,
  type UnifiedCriteria
} from '../services/criteria.js';

const router = Router();

/**
 * GET /api/criteria
 * Get the entire unified criteria file.
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const criteria = loadUnifiedCriteria();
    const stats = getCriteriaStats();

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
 * Get statistics about the criteria.
 */
router.get('/stats', (_req: Request, res: Response) => {
  try {
    const stats = getCriteriaStats();
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
 * Get criteria for a specific domain.
 */
router.get('/domain/:domain', (req: Request, res: Response) => {
  try {
    const domain = req.params.domain;
    const rules = getDomainCriteria(domain);

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
 * Add a new rule to the criteria.
 *
 * Body: { domain, action, subjectPattern?, subdomain? }
 */
router.post('/rule', (req: Request, res: Response) => {
  try {
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

    if (!action || !['delete', 'delete_1d', 'keep'].includes(action)) {
      res.status(400).json({
        success: false,
        error: 'Valid action is required (delete, delete_1d, keep)'
      });
      return;
    }

    addRule(domain, action, subjectPattern, subdomain);

    const message = subjectPattern
      ? `Added ${action} rule for ${domain}: "${subjectPattern}"`
      : `Set default ${action} for ${domain}`;

    console.log(message);

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
 * Remove a rule from the criteria.
 *
 * Body: { domain, action?, subjectPattern?, subdomain? }
 */
router.delete('/rule', (req: Request, res: Response) => {
  try {
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

    const removed = removeRule(domain, action, subjectPattern, subdomain);

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
router.put('/domain/:domain', (req: Request, res: Response) => {
  try {
    const domain = req.params.domain.toLowerCase();
    const rules = req.body as DomainRules;

    const criteria = loadUnifiedCriteria();
    criteria[domain] = rules;
    saveUnifiedCriteria(criteria);

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
router.delete('/domain/:domain', (req: Request, res: Response) => {
  try {
    const domain = req.params.domain.toLowerCase();

    const criteria = loadUnifiedCriteria();

    if (!criteria[domain]) {
      res.status(404).json({
        success: false,
        error: 'Domain not found'
      });
      return;
    }

    delete criteria[domain];
    saveUnifiedCriteria(criteria);

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
 * Search for domains matching a pattern.
 */
router.get('/search', (req: Request, res: Response) => {
  try {
    const query = (req.query.q as string || '').toLowerCase();

    if (!query) {
      res.status(400).json({
        success: false,
        error: 'Query parameter q is required'
      });
      return;
    }

    const criteria = loadUnifiedCriteria();
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
