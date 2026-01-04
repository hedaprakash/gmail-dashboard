/**
 * Criteria Service - Unified Format with SQL Server Support
 *
 * Handles loading, saving, and matching criteria using either SQL Server
 * or the JSON file, controlled by USE_SQL_DATABASE environment variable.
 */

import fs from 'fs';
import path from 'path';
import type { EmailData } from '../types/index.js';
import { USE_SQL_DATABASE } from '../config/database.js';
import {
  queryAll,
  queryOne,
  query,
  insert,
  remove,
  type CriteriaRow,
  type PatternRow,
  type EmailPatternRow,
} from './database.js';

// Types for the unified format
export type Action = 'delete' | 'delete_1d' | 'delete_10d' | 'keep';

export interface EmailRules {
  keep?: string[];
  delete?: string[];
}

export interface DomainRules {
  default?: Action | null;
  excludeSubjects?: string[];
  keep?: string[];
  delete?: string[];
  delete_1d?: string[];
  delete_10d?: string[];
  fromEmails?: EmailRules;
  toEmails?: EmailRules;
  subdomains?: { [subdomain: string]: DomainRules };
}

export interface UnifiedCriteria {
  [primaryDomain: string]: DomainRules;
}

// Result of matching an email against criteria
export interface MatchResult {
  action: Action | null;
  matchedDomain: string;
  matchedSubdomain?: string;
  matchedPattern?: string;
  matchedEmail?: string;
  reason: string;
}

// Resolve paths relative to the project root (gmail-dashboard)
const PROJECT_ROOT = process.cwd();
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
export const UNIFIED_CRITERIA_FILE = path.join(DATA_DIR, 'criteria_unified.json');

// Legacy file paths (for backwards compatibility during transition)
export const CRITERIA_FILE = path.join(DATA_DIR, 'criteria.json');
export const CRITERIA_1DAY_FILE = path.join(DATA_DIR, 'criteria_1day_old.json');
export const CRITERIA_10DAY_FILE = path.join(DATA_DIR, 'criteria_10day_old.json');
export const KEEP_CRITERIA_FILE = path.join(DATA_DIR, 'keep_criteria.json');

// Cache for criteria (used for both JSON and SQL modes)
let criteriaCache: UnifiedCriteria | null = null;
let criteriaCacheTime: number = 0;
const CACHE_TTL = 5000; // 5 seconds

// ============================================================================
// SQL-based implementation
// ============================================================================

/**
 * Load all criteria from SQL Server and transform to UnifiedCriteria format.
 */
async function loadCriteriaFromSQL(): Promise<UnifiedCriteria> {
  const criteria: UnifiedCriteria = {};

  // Get all criteria entries
  const rows = await queryAll<CriteriaRow>(`
    SELECT id, key_value, key_type, default_action, parent_id
    FROM criteria
    ORDER BY key_type, key_value
  `);

  // Get all patterns
  const patterns = await queryAll<PatternRow>(`
    SELECT id, criteria_id, action, pattern
    FROM patterns
  `);

  // Get all email patterns
  const emailPatterns = await queryAll<EmailPatternRow>(`
    SELECT id, criteria_id, direction, action, email
    FROM email_patterns
  `);

  // Create lookup maps
  const patternsByParent = new Map<number, PatternRow[]>();
  for (const p of patterns) {
    if (!patternsByParent.has(p.criteria_id)) {
      patternsByParent.set(p.criteria_id, []);
    }
    patternsByParent.get(p.criteria_id)!.push(p);
  }

  const emailPatternsByParent = new Map<number, EmailPatternRow[]>();
  for (const ep of emailPatterns) {
    if (!emailPatternsByParent.has(ep.criteria_id)) {
      emailPatternsByParent.set(ep.criteria_id, []);
    }
    emailPatternsByParent.get(ep.criteria_id)!.push(ep);
  }

  // Build rules for a criteria entry
  function buildRules(row: CriteriaRow): DomainRules {
    const rules: DomainRules = {};

    if (row.default_action) {
      rules.default = row.default_action;
    }

    // Add patterns
    const rowPatterns = patternsByParent.get(row.id) || [];
    for (const p of rowPatterns) {
      if (!rules[p.action]) {
        rules[p.action] = [];
      }
      rules[p.action]!.push(p.pattern);
    }

    // Add email patterns
    const rowEmailPatterns = emailPatternsByParent.get(row.id) || [];
    for (const ep of rowEmailPatterns) {
      const key = ep.direction === 'from' ? 'fromEmails' : 'toEmails';
      if (!rules[key]) {
        rules[key] = {};
      }
      if (!rules[key]![ep.action]) {
        rules[key]![ep.action] = [];
      }
      rules[key]![ep.action]!.push(ep.email);
    }

    return rules;
  }

  // Create lookup for parent domains/emails
  const rowById = new Map<number, CriteriaRow>();
  for (const row of rows) {
    rowById.set(row.id, row);
  }

  // First pass: create primary entries (domains and emails at top level)
  for (const row of rows) {
    if (row.key_type === 'domain' || row.key_type === 'email') {
      criteria[row.key_value] = buildRules(row);
    }
  }

  // Second pass: add subdomains
  for (const row of rows) {
    if (row.key_type === 'subdomain' && row.parent_id) {
      const parent = rowById.get(row.parent_id);
      if (parent && criteria[parent.key_value]) {
        if (!criteria[parent.key_value].subdomains) {
          criteria[parent.key_value].subdomains = {};
        }
        criteria[parent.key_value].subdomains![row.key_value] = buildRules(row);
      }
    }
  }

  return criteria;
}

/**
 * Get or create a criteria entry by key.
 */
async function getOrCreateCriteria(
  keyValue: string,
  keyType: 'domain' | 'subdomain' | 'email',
  parentId?: number
): Promise<number> {
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM criteria WHERE key_value = @keyValue`,
    { keyValue }
  );

  if (existing) {
    return existing.id;
  }

  const id = await insert('criteria', {
    key_value: keyValue,
    key_type: keyType,
    parent_id: parentId || null,
  });

  return id;
}

/**
 * Add a rule to SQL database.
 */
async function addRuleToSQL(
  domain: string,
  action: Action,
  subjectPattern?: string,
  subdomain?: string
): Promise<void> {
  const domainLower = domain.toLowerCase();
  let criteriaId: number;

  if (subdomain) {
    // Ensure parent domain exists
    const parentId = await getOrCreateCriteria(domainLower, 'domain');
    criteriaId = await getOrCreateCriteria(subdomain.toLowerCase(), 'subdomain', parentId);
  } else {
    // Determine if this is an email or domain
    const keyType = domainLower.includes('@') ? 'email' : 'domain';
    criteriaId = await getOrCreateCriteria(domainLower, keyType);
  }

  if (subjectPattern) {
    // Check if pattern already exists
    const existing = await queryOne<PatternRow>(
      `SELECT id FROM patterns
       WHERE criteria_id = @criteriaId AND action = @action AND LOWER(pattern) = LOWER(@pattern)`,
      { criteriaId, action, pattern: subjectPattern }
    );

    if (!existing) {
      await insert('patterns', {
        criteria_id: criteriaId,
        action,
        pattern: subjectPattern,
      });
    }
  } else {
    // Set default action
    await query(
      `UPDATE criteria SET default_action = @action WHERE id = @criteriaId`,
      { criteriaId, action }
    );
  }

  // Invalidate cache
  criteriaCache = null;
}

/**
 * Remove a rule from SQL database.
 */
async function removeRuleFromSQL(
  domain: string,
  action?: Action,
  subjectPattern?: string,
  subdomain?: string
): Promise<boolean> {
  const domainLower = domain.toLowerCase();

  // Find the criteria entry
  let keyValue = subdomain ? subdomain.toLowerCase() : domainLower;
  const existing = await queryOne<CriteriaRow>(
    `SELECT id FROM criteria WHERE key_value = @keyValue`,
    { keyValue }
  );

  if (!existing) {
    return false;
  }

  let removed = false;

  if (subjectPattern && action) {
    // Remove specific pattern
    const result = await remove(
      'patterns',
      'criteria_id = @criteriaId AND action = @action AND LOWER(pattern) = LOWER(@pattern)',
      { criteriaId: existing.id, action, pattern: subjectPattern }
    );
    removed = result > 0;
  } else if (action) {
    // Remove all patterns for action and clear default if matches
    await remove('patterns', 'criteria_id = @criteriaId AND action = @action', {
      criteriaId: existing.id,
      action,
    });
    await query(
      `UPDATE criteria SET default_action = NULL, updated_at = GETDATE()
       WHERE id = @criteriaId AND default_action = @action`,
      { criteriaId: existing.id, action }
    );
    removed = true;
  } else {
    // Remove entire criteria entry
    await query(`DELETE FROM criteria WHERE id = @id`, { id: existing.id });
    removed = true;
  }

  // Invalidate cache
  criteriaCache = null;
  return removed;
}

/**
 * Get statistics from SQL database.
 */
async function getStatsFromSQL(): Promise<{
  totalDomains: number;
  withDefault: { delete: number; delete_1d: number; delete_10d: number; keep: number };
  withSubjectPatterns: number;
  withSubdomains: number;
  withExcludeSubjects: number;
  withEmailPatterns: number;
}> {
  const result = await queryOne<{
    total: number;
    delete_count: number;
    delete_1d_count: number;
    delete_10d_count: number;
    keep_count: number;
    with_patterns: number;
    with_subdomains: number;
    with_email_patterns: number;
  }>(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN default_action = 'delete' THEN 1 ELSE 0 END) as delete_count,
      SUM(CASE WHEN default_action = 'delete_1d' THEN 1 ELSE 0 END) as delete_1d_count,
      SUM(CASE WHEN default_action = 'delete_10d' THEN 1 ELSE 0 END) as delete_10d_count,
      SUM(CASE WHEN default_action = 'keep' THEN 1 ELSE 0 END) as keep_count,
      (SELECT COUNT(DISTINCT criteria_id) FROM patterns) as with_patterns,
      SUM(CASE WHEN key_type = 'subdomain' THEN 1 ELSE 0 END) as with_subdomains,
      (SELECT COUNT(DISTINCT criteria_id) FROM email_patterns) as with_email_patterns
    FROM criteria
  `);

  return {
    totalDomains: result?.total || 0,
    withDefault: {
      delete: result?.delete_count || 0,
      delete_1d: result?.delete_1d_count || 0,
      delete_10d: result?.delete_10d_count || 0,
      keep: result?.keep_count || 0,
    },
    withSubjectPatterns: result?.with_patterns || 0,
    withSubdomains: result?.with_subdomains || 0,
    withExcludeSubjects: 0, // Deprecated
    withEmailPatterns: result?.with_email_patterns || 0,
  };
}

// ============================================================================
// JSON-based implementation (original)
// ============================================================================

/**
 * Load the unified criteria from JSON file.
 */
function loadCriteriaFromJSON(): UnifiedCriteria {
  try {
    if (fs.existsSync(UNIFIED_CRITERIA_FILE)) {
      const content = fs.readFileSync(UNIFIED_CRITERIA_FILE, 'utf-8');
      return JSON.parse(content) as UnifiedCriteria;
    }
  } catch (error) {
    console.error(`Error loading ${UNIFIED_CRITERIA_FILE}:`, error);
  }
  return {};
}

/**
 * Save the unified criteria to JSON file.
 */
function saveCriteriaToJSON(criteria: UnifiedCriteria): void {
  // Sort domains alphabetically
  const sorted: UnifiedCriteria = {};
  for (const domain of Object.keys(criteria).sort()) {
    sorted[domain] = criteria[domain];
  }

  fs.writeFileSync(UNIFIED_CRITERIA_FILE, JSON.stringify(sorted, null, 2), 'utf-8');
}

// ============================================================================
// Public API (auto-selects SQL or JSON based on USE_SQL_DATABASE flag)
// ============================================================================

/**
 * Load the unified criteria file.
 */
export function loadUnifiedCriteria(): UnifiedCriteria {
  const now = Date.now();
  if (criteriaCache && (now - criteriaCacheTime) < CACHE_TTL) {
    return criteriaCache;
  }

  // For sync operations, use JSON. SQL loading is async.
  const criteria = loadCriteriaFromJSON();
  criteriaCache = criteria;
  criteriaCacheTime = now;
  return criteria;
}

/**
 * Load the unified criteria (async version for SQL).
 */
export async function loadUnifiedCriteriaAsync(): Promise<UnifiedCriteria> {
  const now = Date.now();
  if (criteriaCache && (now - criteriaCacheTime) < CACHE_TTL) {
    return criteriaCache;
  }

  let criteria: UnifiedCriteria;

  if (USE_SQL_DATABASE) {
    try {
      criteria = await loadCriteriaFromSQL();
    } catch (error) {
      console.error('Failed to load from SQL, falling back to JSON:', error);
      criteria = loadCriteriaFromJSON();
    }
  } else {
    criteria = loadCriteriaFromJSON();
  }

  criteriaCache = criteria;
  criteriaCacheTime = now;
  return criteria;
}

/**
 * Save the unified criteria file.
 */
export function saveUnifiedCriteria(criteria: UnifiedCriteria): void {
  // Sort domains alphabetically
  const sorted: UnifiedCriteria = {};
  for (const domain of Object.keys(criteria).sort()) {
    sorted[domain] = criteria[domain];
  }

  saveCriteriaToJSON(sorted);
  criteriaCache = sorted;
  criteriaCacheTime = Date.now();
}

/**
 * Invalidate the criteria cache.
 */
export function invalidateCache(): void {
  criteriaCache = null;
  criteriaCacheTime = 0;
}

/**
 * Check if a subject matches any pattern in a list (case-insensitive contains).
 */
function matchesSubjectPattern(subject: string, patterns: string[]): string | null {
  const subjectLower = subject.toLowerCase();
  for (const pattern of patterns) {
    if (subjectLower.includes(pattern.toLowerCase())) {
      return pattern;
    }
  }
  return null;
}

/**
 * Check if subject contains any excluded term.
 */
function isExcludedSubject(subject: string, excludeSubjects: string[]): boolean {
  const subjectLower = subject.toLowerCase();
  return excludeSubjects.some(term => subjectLower.includes(term.toLowerCase()));
}

/**
 * Check if an email address matches any in a list.
 */
function matchesEmailPattern(email: string, patterns: string[]): string | null {
  const emailLower = email.toLowerCase();
  for (const pattern of patterns) {
    if (emailLower === pattern.toLowerCase()) {
      return pattern;
    }
  }
  return null;
}

/**
 * Get the action for an email based on domain rules.
 * Priority: fromEmails/toEmails > subject patterns (keep > delete > delete_1d) > excludeSubjects > default
 */
function getActionFromRules(
  rules: DomainRules,
  subject: string,
  fromEmail?: string,
  toEmail?: string
): { action: Action | null; pattern?: string; matchedEmail?: string; reason: string } {
  // 0. Check fromEmails (highest priority)
  if (fromEmail && rules.fromEmails) {
    if (rules.fromEmails.keep?.length) {
      const matched = matchesEmailPattern(fromEmail, rules.fromEmails.keep);
      if (matched) {
        return { action: 'keep', matchedEmail: matched, reason: 'from email matches keep list' };
      }
    }
    if (rules.fromEmails.delete?.length) {
      const matched = matchesEmailPattern(fromEmail, rules.fromEmails.delete);
      if (matched) {
        return { action: 'delete', matchedEmail: matched, reason: 'from email matches delete list' };
      }
    }
  }

  // 0b. Check toEmails
  if (toEmail && rules.toEmails) {
    if (rules.toEmails.keep?.length) {
      const matched = matchesEmailPattern(toEmail, rules.toEmails.keep);
      if (matched) {
        return { action: 'keep', matchedEmail: matched, reason: 'to email matches keep list' };
      }
    }
    if (rules.toEmails.delete?.length) {
      const matched = matchesEmailPattern(toEmail, rules.toEmails.delete);
      if (matched) {
        return { action: 'delete', matchedEmail: matched, reason: 'to email matches delete list' };
      }
    }
  }

  // 1. Check explicit subject patterns (keep has highest priority)
  if (rules.keep?.length) {
    const matched = matchesSubjectPattern(subject, rules.keep);
    if (matched) {
      return { action: 'keep', pattern: matched, reason: 'subject matches keep pattern' };
    }
  }

  if (rules.delete?.length) {
    const matched = matchesSubjectPattern(subject, rules.delete);
    if (matched) {
      return { action: 'delete', pattern: matched, reason: 'subject matches delete pattern' };
    }
  }

  if (rules.delete_1d?.length) {
    const matched = matchesSubjectPattern(subject, rules.delete_1d);
    if (matched) {
      return { action: 'delete_1d', pattern: matched, reason: 'subject matches delete_1d pattern' };
    }
  }

  if (rules.delete_10d?.length) {
    const matched = matchesSubjectPattern(subject, rules.delete_10d);
    if (matched) {
      return { action: 'delete_10d', pattern: matched, reason: 'subject matches delete_10d pattern' };
    }
  }

  // 2. Check excludeSubjects - if matched, KEEP the email
  if (rules.excludeSubjects?.length && isExcludedSubject(subject, rules.excludeSubjects)) {
    return { action: 'keep', reason: 'subject matches excludeSubjects (protected)' };
  }

  // 3. Apply default action (if set)
  if (rules.default) {
    return { action: rules.default, reason: 'default action' };
  }

  // 4. No match
  return { action: null, reason: 'no matching rule' };
}

/**
 * Match an email against the unified criteria.
 * Returns the action to take and details about the match.
 */
export function matchEmail(emailData: EmailData): MatchResult {
  const criteria = loadUnifiedCriteria();
  const primaryDomain = emailData.primaryDomain.toLowerCase();
  const subdomain = emailData.subdomain?.toLowerCase() || '';
  const subject = emailData.subject || '';
  const fromEmail = emailData.email?.toLowerCase();
  const toEmail = emailData.toEmails?.toLowerCase();

  // Check if there's a specific email address rule (highest priority)
  if (fromEmail && criteria[fromEmail]) {
    const result = getActionFromRules(criteria[fromEmail], subject, fromEmail, toEmail);
    return {
      action: result.action,
      matchedDomain: fromEmail,
      matchedPattern: result.pattern,
      matchedEmail: result.matchedEmail,
      reason: result.reason,
    };
  }

  // Look up the primary domain
  const domainRules = criteria[primaryDomain];
  if (!domainRules) {
    return { action: null, matchedDomain: primaryDomain, reason: 'domain not in criteria' };
  }

  // Check if there's a subdomain-specific rule
  if (subdomain && domainRules.subdomains) {
    const subdomainRules = domainRules.subdomains[subdomain];
    if (subdomainRules) {
      // Use subdomain rules (completely overrides parent)
      const result = getActionFromRules(subdomainRules, subject, fromEmail, toEmail);
      return {
        action: result.action,
        matchedDomain: primaryDomain,
        matchedSubdomain: subdomain,
        matchedPattern: result.pattern,
        matchedEmail: result.matchedEmail,
        reason: result.reason,
      };
    }
  }

  // Use domain-level rules
  const result = getActionFromRules(domainRules, subject, fromEmail, toEmail);
  return {
    action: result.action,
    matchedDomain: primaryDomain,
    matchedPattern: result.pattern,
    matchedEmail: result.matchedEmail,
    reason: result.reason,
  };
}

/**
 * Check if email matches criteria for a specific action type.
 */
export function matchesAction(emailData: EmailData, action: Action): boolean {
  const result = matchEmail(emailData);
  return result.action === action;
}

/**
 * Legacy compatibility: Check if email matches any "delete" criteria.
 */
export function matchesDeleteCriteria(emailData: EmailData): boolean {
  return matchesAction(emailData, 'delete');
}

/**
 * Legacy compatibility: Check if email matches any "delete_1d" criteria.
 */
export function matchesDelete1dCriteria(emailData: EmailData): boolean {
  return matchesAction(emailData, 'delete_1d');
}

/**
 * Legacy compatibility: Check if email matches any "keep" criteria.
 */
export function matchesKeepCriteria(emailData: EmailData): boolean {
  return matchesAction(emailData, 'keep');
}

/**
 * Add a rule to the criteria.
 */
export function addRule(
  domain: string,
  action: Action,
  subjectPattern?: string,
  subdomain?: string
): void {
  if (USE_SQL_DATABASE) {
    // Queue async operation (fire and forget for sync API)
    addRuleToSQL(domain, action, subjectPattern, subdomain).catch((err) =>
      console.error('Failed to add rule to SQL:', err)
    );
  }

  // Always update JSON for backup and sync API compatibility
  const criteria = loadUnifiedCriteria();
  const domainLower = domain.toLowerCase();

  // Ensure domain exists
  if (!criteria[domainLower]) {
    criteria[domainLower] = {};
  }

  let targetRules = criteria[domainLower];

  // Handle subdomain
  if (subdomain) {
    const subdomainLower = subdomain.toLowerCase();
    if (!targetRules.subdomains) {
      targetRules.subdomains = {};
    }
    if (!targetRules.subdomains[subdomainLower]) {
      targetRules.subdomains[subdomainLower] = {};
    }
    targetRules = targetRules.subdomains[subdomainLower];
  }

  if (subjectPattern) {
    // Add to subject pattern list
    const key = action as 'keep' | 'delete' | 'delete_1d' | 'delete_10d';
    if (!targetRules[key]) {
      targetRules[key] = [];
    }
    const patternLower = subjectPattern.toLowerCase();
    if (!targetRules[key]!.some(p => p.toLowerCase() === patternLower)) {
      targetRules[key]!.push(subjectPattern);
    }
  } else {
    // Set as default action
    targetRules.default = action;
  }

  saveUnifiedCriteria(criteria);
}

/**
 * Add a rule (async version).
 */
export async function addRuleAsync(
  domain: string,
  action: Action,
  subjectPattern?: string,
  subdomain?: string
): Promise<void> {
  if (USE_SQL_DATABASE) {
    await addRuleToSQL(domain, action, subjectPattern, subdomain);
  }

  // Also update JSON for backup
  addRule(domain, action, subjectPattern, subdomain);
}

/**
 * Remove a rule from the criteria.
 * If removing the last rule for a domain, removes the domain entirely.
 */
export function removeRule(
  domain: string,
  action?: Action,
  subjectPattern?: string,
  subdomain?: string
): boolean {
  if (USE_SQL_DATABASE) {
    // Queue async operation
    removeRuleFromSQL(domain, action, subjectPattern, subdomain).catch((err) =>
      console.error('Failed to remove rule from SQL:', err)
    );
  }

  // Always update JSON
  const criteria = loadUnifiedCriteria();
  const domainLower = domain.toLowerCase();

  if (!criteria[domainLower]) {
    return false;
  }

  let targetRules = criteria[domainLower];
  let parentRules = criteria[domainLower];

  // Handle subdomain
  if (subdomain) {
    const subdomainLower = subdomain.toLowerCase();
    if (!targetRules.subdomains?.[subdomainLower]) {
      return false;
    }
    targetRules = targetRules.subdomains[subdomainLower];
  }

  let removed = false;

  if (subjectPattern && action) {
    // Remove specific subject pattern
    const key = action as 'keep' | 'delete' | 'delete_1d' | 'delete_10d';
    if (targetRules[key]) {
      const patternLower = subjectPattern.toLowerCase();
      const idx = targetRules[key]!.findIndex(p => p.toLowerCase() === patternLower);
      if (idx >= 0) {
        targetRules[key]!.splice(idx, 1);
        if (targetRules[key]!.length === 0) {
          delete targetRules[key];
        }
        removed = true;
      }
    }
  } else if (action) {
    // Remove all patterns for an action or clear default
    const key = action as 'keep' | 'delete' | 'delete_1d' | 'delete_10d';
    if (targetRules[key]) {
      delete targetRules[key];
      removed = true;
    }
    if (targetRules.default === action) {
      delete targetRules.default;
      removed = true;
    }
  } else {
    // Remove entire domain or subdomain
    if (subdomain) {
      const subdomainLower = subdomain.toLowerCase();
      delete parentRules.subdomains![subdomainLower];
      if (Object.keys(parentRules.subdomains!).length === 0) {
        delete parentRules.subdomains;
      }
    } else {
      delete criteria[domainLower];
    }
    removed = true;
  }

  // Clean up empty domain entries
  if (criteria[domainLower]) {
    const rules = criteria[domainLower];
    const isEmpty = !rules.default &&
      !rules.keep?.length &&
      !rules.delete?.length &&
      !rules.delete_1d?.length &&
      !rules.delete_10d?.length &&
      !rules.excludeSubjects?.length &&
      !rules.fromEmails &&
      !rules.toEmails &&
      !rules.subdomains;
    if (isEmpty) {
      delete criteria[domainLower];
    }
  }

  if (removed) {
    saveUnifiedCriteria(criteria);
  }
  return removed;
}

/**
 * Update all rules for a domain (SQL-aware).
 * This replaces the domain's rules entirely.
 */
export async function updateDomainRulesAsync(
  domain: string,
  rules: DomainRules
): Promise<void> {
  const domainLower = domain.toLowerCase();

  if (USE_SQL_DATABASE) {
    // Get or create domain entry
    const criteriaId = await getOrCreateCriteria(domainLower, 'domain');

    // Update default action
    if (rules.default !== undefined) {
      await query(
        `UPDATE criteria SET default_action = @action WHERE id = @criteriaId`,
        { criteriaId, action: rules.default }
      );
    }

    // Clear existing patterns for this domain
    await query(
      `DELETE FROM patterns WHERE criteria_id = @criteriaId`,
      { criteriaId }
    );

    // Add new patterns
    const patternTypes: (keyof DomainRules)[] = ['keep', 'delete', 'delete_1d', 'delete_10d'];
    for (const action of patternTypes) {
      const patterns = rules[action] as string[] | undefined;
      if (patterns && patterns.length > 0) {
        for (const pattern of patterns) {
          await insert('patterns', {
            criteria_id: criteriaId,
            action,
            pattern,
          });
        }
      }
    }

    // Invalidate cache
    criteriaCache = null;
  }

  // Always update JSON as backup
  const criteria = loadUnifiedCriteria();
  criteria[domainLower] = rules;
  saveUnifiedCriteria(criteria);
}

/**
 * Delete all rules for a domain (SQL-aware).
 */
export async function deleteDomainAsync(domain: string): Promise<boolean> {
  const domainLower = domain.toLowerCase();

  if (USE_SQL_DATABASE) {
    // Find the criteria entry for this domain
    const result = await queryAll<{ id: number }>(
      `SELECT id FROM criteria WHERE key_value = @domain AND key_type = 'domain'`,
      { domain: domainLower }
    );

    if (result.length === 0) {
      // Check in JSON as fallback
      const criteria = loadUnifiedCriteria();
      if (!criteria[domainLower]) {
        return false;
      }
      delete criteria[domainLower];
      saveUnifiedCriteria(criteria);
      return true;
    }

    const criteriaId = result[0].id;

    // Delete patterns first (foreign key - cascade should handle this but be explicit)
    await query(
      `DELETE FROM patterns WHERE criteria_id = @criteriaId`,
      { criteriaId }
    );

    // Delete email_patterns if any
    await query(
      `DELETE FROM email_patterns WHERE criteria_id = @criteriaId`,
      { criteriaId }
    );

    // Delete the criteria entry
    await query(
      `DELETE FROM criteria WHERE id = @criteriaId`,
      { criteriaId }
    );

    // Invalidate cache
    criteriaCache = null;
  }

  // Also update JSON backup
  const criteria = loadUnifiedCriteria();
  if (criteria[domainLower]) {
    delete criteria[domainLower];
    saveUnifiedCriteria(criteria);
  }
  return true;
}

/**
 * Mark a domain/pattern as keep (SQL-aware).
 * Removes from delete/delete_1d/delete_10d lists and adds to keep.
 * Returns the number of delete rules removed.
 */
export async function markKeepAsync(
  domain: string,
  subjectPattern?: string
): Promise<{ removedCount: number; rules: DomainRules | null }> {
  const domainLower = domain.toLowerCase();
  let removedCount = 0;

  if (USE_SQL_DATABASE) {
    // Get criteria ID for this domain
    const result = await queryAll<{ id: number }>(
      `SELECT id FROM criteria WHERE key_value = @domain AND key_type = 'domain'`,
      { domain: domainLower }
    );

    if (result.length > 0) {
      const criteriaId = result[0].id;

      if (subjectPattern) {
        // Remove specific pattern from delete lists
        const patternLower = subjectPattern.toLowerCase();
        const deleteResult = await query(
          `DELETE FROM patterns
           WHERE criteria_id = @criteriaId
             AND action IN ('delete', 'delete_1d', 'delete_10d')
             AND LOWER(pattern) = @pattern`,
          { criteriaId, pattern: patternLower }
        );
        removedCount = deleteResult.rowsAffected?.[0] || 0;

        // Add to keep list (if not already there)
        const existing = await queryAll<{ id: number }>(
          `SELECT id FROM patterns
           WHERE criteria_id = @criteriaId
             AND action = 'keep'
             AND LOWER(pattern) = @pattern`,
          { criteriaId, pattern: patternLower }
        );
        if (existing.length === 0) {
          await insert('patterns', {
            criteria_id: criteriaId,
            action: 'keep',
            pattern: subjectPattern,
          });
        }
      } else {
        // Domain-level keep - remove all delete patterns and set default to keep
        const deleteResult = await query(
          `DELETE FROM patterns
           WHERE criteria_id = @criteriaId
             AND action IN ('delete', 'delete_1d', 'delete_10d')`,
          { criteriaId }
        );
        removedCount = deleteResult.rowsAffected?.[0] || 0;

        // Update default action to keep
        await query(
          `UPDATE criteria SET default_action = 'keep' WHERE id = @criteriaId`,
          { criteriaId }
        );
      }
    } else {
      // Domain doesn't exist yet, create it with keep
      const criteriaId = await getOrCreateCriteria(domainLower, 'domain');
      if (subjectPattern) {
        await insert('patterns', {
          criteria_id: criteriaId,
          action: 'keep',
          pattern: subjectPattern,
        });
      } else {
        await query(
          `UPDATE criteria SET default_action = 'keep' WHERE id = @criteriaId`,
          { criteriaId }
        );
      }
    }

    // Invalidate cache
    criteriaCache = null;
  }

  // Also update JSON backup
  const criteria = loadUnifiedCriteria();
  if (criteria[domainLower]) {
    const rules = criteria[domainLower];

    if (subjectPattern) {
      // Remove specific pattern from delete lists
      for (const key of ['delete', 'delete_1d', 'delete_10d'] as const) {
        if (rules[key]) {
          const patternLower = subjectPattern.toLowerCase();
          const idx = rules[key]!.findIndex(p => p.toLowerCase() === patternLower);
          if (idx >= 0) {
            rules[key]!.splice(idx, 1);
            if (rules[key]!.length === 0) delete rules[key];
            if (!USE_SQL_DATABASE) removedCount++;
          }
        }
      }
      // Add to keep list
      if (!rules.keep) rules.keep = [];
      const patternLower = subjectPattern.toLowerCase();
      if (!rules.keep.some(p => p.toLowerCase() === patternLower)) {
        rules.keep.push(subjectPattern);
      }
    } else {
      // Domain-level keep
      if (rules.default === 'delete' || rules.default === 'delete_1d' || rules.default === 'delete_10d') {
        if (!USE_SQL_DATABASE) removedCount++;
      }
      if (rules.delete) {
        if (!USE_SQL_DATABASE) removedCount += rules.delete.length;
        delete rules.delete;
      }
      if (rules.delete_1d) {
        if (!USE_SQL_DATABASE) removedCount += rules.delete_1d.length;
        delete rules.delete_1d;
      }
      if (rules.delete_10d) {
        if (!USE_SQL_DATABASE) removedCount += rules.delete_10d.length;
        delete rules.delete_10d;
      }
      rules.default = 'keep';
    }
  } else {
    // Create domain with keep
    if (subjectPattern) {
      criteria[domainLower] = { keep: [subjectPattern] };
    } else {
      criteria[domainLower] = { default: 'keep' };
    }
  }
  saveUnifiedCriteria(criteria);

  // Get updated rules from SQL if available, otherwise from local
  let finalRules: DomainRules | null;
  if (USE_SQL_DATABASE) {
    finalRules = await getDomainCriteriaAsync(domainLower);
  } else {
    finalRules = criteria[domainLower] || null;
  }

  return { removedCount, rules: finalRules };
}

/**
 * Add exclude subjects to a domain.
 */
export function addExcludeSubjects(domain: string, terms: string[]): void {
  const criteria = loadUnifiedCriteria();
  const domainLower = domain.toLowerCase();

  if (!criteria[domainLower]) {
    criteria[domainLower] = {};
  }

  if (!criteria[domainLower].excludeSubjects) {
    criteria[domainLower].excludeSubjects = [];
  }

  for (const term of terms) {
    const termLower = term.toLowerCase();
    if (!criteria[domainLower].excludeSubjects!.some(t => t.toLowerCase() === termLower)) {
      criteria[domainLower].excludeSubjects!.push(term);
    }
  }

  saveUnifiedCriteria(criteria);
}

/**
 * Add an email pattern (fromEmails or toEmails).
 */
export async function addEmailPattern(
  domain: string,
  direction: 'from' | 'to',
  action: 'keep' | 'delete',
  email: string,
  subdomain?: string
): Promise<void> {
  // Update JSON
  const criteria = loadUnifiedCriteria();
  const domainLower = domain.toLowerCase();

  if (!criteria[domainLower]) {
    criteria[domainLower] = {};
  }

  let targetRules = criteria[domainLower];

  if (subdomain) {
    const subdomainLower = subdomain.toLowerCase();
    if (!targetRules.subdomains) {
      targetRules.subdomains = {};
    }
    if (!targetRules.subdomains[subdomainLower]) {
      targetRules.subdomains[subdomainLower] = {};
    }
    targetRules = targetRules.subdomains[subdomainLower];
  }

  const key = direction === 'from' ? 'fromEmails' : 'toEmails';
  if (!targetRules[key]) {
    targetRules[key] = {};
  }
  if (!targetRules[key]![action]) {
    targetRules[key]![action] = [];
  }

  const emailLower = email.toLowerCase();
  if (!targetRules[key]![action]!.some(e => e.toLowerCase() === emailLower)) {
    targetRules[key]![action]!.push(email);
  }

  saveUnifiedCriteria(criteria);

  // Update SQL if enabled
  if (USE_SQL_DATABASE) {
    const keyValue = subdomain || domainLower;
    const criteriaRow = await queryOne<CriteriaRow>(
      `SELECT id FROM criteria WHERE key_value = @keyValue`,
      { keyValue }
    );

    if (criteriaRow) {
      await insert('email_patterns', {
        criteria_id: criteriaRow.id,
        direction,
        action,
        email,
      });
      invalidateCache();
    }
  }
}

/**
 * Remove an email pattern.
 */
export async function removeEmailPattern(
  domain: string,
  direction: 'from' | 'to',
  email: string,
  subdomain?: string
): Promise<boolean> {
  // Update JSON
  const criteria = loadUnifiedCriteria();
  const domainLower = domain.toLowerCase();

  if (!criteria[domainLower]) {
    return false;
  }

  let targetRules = criteria[domainLower];

  if (subdomain) {
    const subdomainLower = subdomain.toLowerCase();
    if (!targetRules.subdomains?.[subdomainLower]) {
      return false;
    }
    targetRules = targetRules.subdomains[subdomainLower];
  }

  const key = direction === 'from' ? 'fromEmails' : 'toEmails';
  if (!targetRules[key]) {
    return false;
  }

  let removed = false;
  const emailLower = email.toLowerCase();

  for (const action of ['keep', 'delete'] as const) {
    if (targetRules[key]![action]) {
      const idx = targetRules[key]![action]!.findIndex(e => e.toLowerCase() === emailLower);
      if (idx >= 0) {
        targetRules[key]![action]!.splice(idx, 1);
        if (targetRules[key]![action]!.length === 0) {
          delete targetRules[key]![action];
        }
        removed = true;
      }
    }
  }

  if (Object.keys(targetRules[key]!).length === 0) {
    delete targetRules[key];
  }

  if (removed) {
    saveUnifiedCriteria(criteria);
  }

  // Update SQL if enabled
  if (USE_SQL_DATABASE) {
    const keyValue = subdomain || domainLower;
    await query(
      `DELETE ep FROM email_patterns ep
       INNER JOIN criteria c ON ep.criteria_id = c.id
       WHERE c.key_value = @keyValue AND ep.direction = @direction AND LOWER(ep.email) = LOWER(@email)`,
      { keyValue, direction, email }
    );
    invalidateCache();
  }

  return removed;
}

/**
 * Get all criteria (returns the unified criteria object).
 */
export function getAllCriteria(): UnifiedCriteria {
  return loadUnifiedCriteria();
}

/**
 * Get all criteria (async version).
 */
export async function getAllCriteriaAsync(): Promise<UnifiedCriteria> {
  return loadUnifiedCriteriaAsync();
}

/**
 * Get criteria for a specific domain.
 */
export function getDomainCriteria(domain: string): DomainRules | null {
  const criteria = loadUnifiedCriteria();
  return criteria[domain.toLowerCase()] || null;
}

/**
 * Get criteria for a specific domain (async version for SQL).
 */
export async function getDomainCriteriaAsync(domain: string): Promise<DomainRules | null> {
  const criteria = await loadUnifiedCriteriaAsync();
  return criteria[domain.toLowerCase()] || null;
}

/**
 * Get statistics about the criteria.
 */
export function getCriteriaStats(): {
  totalDomains: number;
  withDefault: { delete: number; delete_1d: number; delete_10d: number; keep: number };
  withSubjectPatterns: number;
  withSubdomains: number;
  withExcludeSubjects: number;
} {
  const criteria = loadUnifiedCriteria();
  const stats = {
    totalDomains: 0,
    withDefault: { delete: 0, delete_1d: 0, delete_10d: 0, keep: 0 },
    withSubjectPatterns: 0,
    withSubdomains: 0,
    withExcludeSubjects: 0,
  };

  for (const rules of Object.values(criteria)) {
    stats.totalDomains++;
    if (rules.default === 'delete') stats.withDefault.delete++;
    if (rules.default === 'delete_1d') stats.withDefault.delete_1d++;
    if (rules.default === 'delete_10d') stats.withDefault.delete_10d++;
    if (rules.default === 'keep') stats.withDefault.keep++;
    if (rules.keep?.length || rules.delete?.length || rules.delete_1d?.length || rules.delete_10d?.length) {
      stats.withSubjectPatterns++;
    }
    if (rules.subdomains && Object.keys(rules.subdomains).length > 0) {
      stats.withSubdomains++;
    }
    if (rules.excludeSubjects?.length) {
      stats.withExcludeSubjects++;
    }
  }

  return stats;
}

/**
 * Get statistics (async version for SQL).
 */
export async function getCriteriaStatsAsync(): Promise<{
  totalDomains: number;
  withDefault: { delete: number; delete_1d: number; delete_10d: number; keep: number };
  withSubjectPatterns: number;
  withSubdomains: number;
  withExcludeSubjects: number;
  withEmailPatterns: number;
}> {
  if (USE_SQL_DATABASE) {
    try {
      return await getStatsFromSQL();
    } catch (error) {
      console.error('Failed to get stats from SQL:', error);
    }
  }

  const jsonStats = getCriteriaStats();
  return { ...jsonStats, withEmailPatterns: 0 };
}

// Legacy exports for backwards compatibility
export type CriteriaEntry = {
  email: string;
  subdomain: string;
  primaryDomain: string;
  subject: string;
  toEmails: string;
  ccEmails: string;
  excludeSubject: string;
};

/**
 * Legacy: Check if email matches any criteria (for delete, delete_1d, or delete_10d).
 */
export function matchesAnyCriteria(emailData: EmailData, _criteriaList?: CriteriaEntry[]): boolean {
  const result = matchEmail(emailData);
  return result.action === 'delete' || result.action === 'delete_1d' || result.action === 'delete_10d';
}

/**
 * Legacy compatibility: Check if email matches any "delete_10d" criteria.
 */
export function matchesDelete10dCriteria(emailData: EmailData): boolean {
  return matchesAction(emailData, 'delete_10d');
}

/**
 * Legacy: Check if email is in keep criteria.
 */
export function matchesKeepList(emailData: EmailData): boolean {
  return matchesKeepCriteria(emailData);
}
