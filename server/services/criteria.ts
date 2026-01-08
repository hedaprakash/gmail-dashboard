/**
 * Criteria Service - SQL Server Implementation
 *
 * Handles loading, saving, and matching criteria using SQL Server.
 * All criteria are stored per-user with audit logging for all changes.
 */

import type { EmailData } from '../types/index.js';
import {
  queryAll,
  queryOne,
  query,
  insert,
  remove,
  logAudit,
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

// Cache for criteria
let criteriaCache: UnifiedCriteria | null = null;
let criteriaCacheTime: number = 0;
const CACHE_TTL = 5000; // 5 seconds

// Default user for backwards compatibility
const DEFAULT_USER = 'default@user.com';

// ============================================================================
// SQL-based implementation (with user filtering)
// ============================================================================

/**
 * Load all criteria from SQL Server and transform to UnifiedCriteria format.
 * Filters by user_email for multi-user support.
 */
async function loadCriteriaFromSQL(userEmail: string = DEFAULT_USER): Promise<UnifiedCriteria> {
  const criteria: UnifiedCriteria = {};

  // Get all criteria entries for this user
  const rows = await queryAll<CriteriaRow>(`
    SELECT id, key_value, key_type, default_action, parent_id
    FROM criteria
    WHERE user_email = @userEmail
    ORDER BY key_type, key_value
  `, { userEmail });

  // Get all patterns for this user's criteria
  const patterns = await queryAll<PatternRow>(`
    SELECT p.id, p.criteria_id, p.action, p.pattern
    FROM patterns p
    INNER JOIN criteria c ON p.criteria_id = c.id
    WHERE c.user_email = @userEmail
  `, { userEmail });

  // Get all email patterns for this user's criteria
  const emailPatterns = await queryAll<EmailPatternRow>(`
    SELECT ep.id, ep.criteria_id, ep.direction, ep.action, ep.email
    FROM email_patterns ep
    INNER JOIN criteria c ON ep.criteria_id = c.id
    WHERE c.user_email = @userEmail
  `, { userEmail });

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
 * Get or create a criteria entry by key for a specific user.
 */
async function getOrCreateCriteria(
  keyValue: string,
  keyType: 'domain' | 'subdomain' | 'email',
  userEmail: string = DEFAULT_USER,
  parentId?: number
): Promise<number> {
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM criteria WHERE key_value = @keyValue AND user_email = @userEmail`,
    { keyValue, userEmail }
  );

  if (existing) {
    return existing.id;
  }

  const id = await insert('criteria', {
    key_value: keyValue,
    key_type: keyType,
    user_email: userEmail,
    parent_id: parentId || null,
  });

  // Audit log: new criteria entry created
  await logAudit(userEmail, 'INSERT', 'criteria', id, keyValue, {
    key_type: keyType,
    parent_id: parentId || null
  });

  return id;
}

/**
 * Result from ModifyCriteria stored procedure
 */
interface ModifyCriteriaResult {
  Success: number;
  Message: string;
  RecordId: number | null;
  AuditId: number | null;
}

/**
 * Call the ModifyCriteria stored procedure.
 * This is the unified way to modify criteria.
 */
async function callModifyCriteria(
  operation: 'ADD' | 'REMOVE' | 'UPDATE' | 'CLEAR',
  dimension: 'domain' | 'subdomain' | 'email' | 'subject' | 'from_email' | 'to_email',
  userEmail: string,
  keyValue?: string,
  action?: Action,
  parentDomain?: string,
  parentSubdomain?: string,
  oldAction?: Action
): Promise<{ success: boolean; message: string; recordId: number | null }> {
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
      operation,
      dimension,
      action: action || null,
      keyValue: keyValue?.toLowerCase() || null,
      userEmail,
      parentDomain: parentDomain?.toLowerCase() || null,
      parentSubdomain: parentSubdomain?.toLowerCase() || null,
      oldAction: oldAction || null
    }
  );

  const row = result.recordset[0];
  return {
    success: row?.Success === 1,
    message: row?.Message || 'No response',
    recordId: row?.RecordId || null
  };
}

/**
 * Result from AddCriteriaRule stored procedure
 */
interface AddCriteriaRuleResult {
  Success: number;
  Message: string;
  CriteriaId: number | null;
  Level: string;
  Action: string;
}

/**
 * Call the AddCriteriaRule stored procedure.
 * TypeScript is a "dumb pipe" - passes raw email fields, SQL handles all business logic.
 * See: docs/adr/ADR-003-add-criteria-rule-workflow.md
 */
async function callAddCriteriaRule(
  fromEmail: string,
  toEmail: string,
  subject: string,
  action: Action,
  level: 'domain' | 'subdomain' | 'from_email' | 'to_email',
  userEmail: string,
  subjectPattern?: string
): Promise<{ success: boolean; message: string; criteriaId: number | null }> {
  const result = await query<AddCriteriaRuleResult>(
    `EXEC dbo.AddCriteriaRule
      @FromEmail = @fromEmail,
      @ToEmail = @toEmail,
      @Subject = @subject,
      @Action = @action,
      @Level = @level,
      @SubjectPattern = @subjectPattern,
      @UserEmail = @userEmail`,
    {
      fromEmail,
      toEmail,
      subject,
      action,
      level,
      subjectPattern: subjectPattern || null,
      userEmail
    }
  );

  const row = result.recordset[0];

  // Invalidate cache after successful operation
  if (row?.Success === 1) {
    criteriaCache = null;
  }

  return {
    success: row?.Success === 1,
    message: row?.Message || 'No response',
    criteriaId: row?.CriteriaId || null
  };
}

/**
 * Remove a rule from SQL database for a specific user.
 * Uses the ModifyCriteria stored procedure.
 */
async function removeRuleFromSQL(
  domain: string,
  userEmail: string = DEFAULT_USER,
  action?: Action,
  subjectPattern?: string,
  subdomain?: string
): Promise<boolean> {
  const domainLower = domain.toLowerCase();

  if (subjectPattern) {
    // Remove specific pattern
    const result = await callModifyCriteria(
      'REMOVE',
      'subject',
      userEmail,
      subjectPattern,
      action,
      domainLower,
      subdomain?.toLowerCase()
    );
    criteriaCache = null;
    return result.success;
  } else if (subdomain) {
    // Remove subdomain
    const result = await callModifyCriteria(
      'REMOVE',
      'subdomain',
      userEmail,
      subdomain.toLowerCase(),
      undefined,
      domainLower
    );
    criteriaCache = null;
    return result.success;
  } else {
    // Remove entire domain
    const dimension = domainLower.includes('@') ? 'email' : 'domain';
    const result = await callModifyCriteria('REMOVE', dimension, userEmail, domainLower);
    criteriaCache = null;
    return result.success;
  }
}

/**
 * Get statistics from SQL database for a specific user.
 */
async function getStatsFromSQL(userEmail: string = DEFAULT_USER): Promise<{
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
      (SELECT COUNT(DISTINCT p.criteria_id) FROM patterns p INNER JOIN criteria c ON p.criteria_id = c.id WHERE c.user_email = @userEmail) as with_patterns,
      SUM(CASE WHEN key_type = 'subdomain' THEN 1 ELSE 0 END) as with_subdomains,
      (SELECT COUNT(DISTINCT ep.criteria_id) FROM email_patterns ep INNER JOIN criteria c ON ep.criteria_id = c.id WHERE c.user_email = @userEmail) as with_email_patterns
    FROM criteria
    WHERE user_email = @userEmail
  `, { userEmail });

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
// Public API
// ============================================================================

/**
 * Load the unified criteria (sync version).
 * Returns cache only - use loadUnifiedCriteriaAsync for fresh data from SQL.
 */
export function loadUnifiedCriteria(): UnifiedCriteria {
  const now = Date.now();
  if (criteriaCache && (now - criteriaCacheTime) < CACHE_TTL) {
    return criteriaCache;
  }
  return criteriaCache || {};
}

/**
 * Load the unified criteria (async version for SQL).
 * Supports multi-user with userEmail parameter.
 */
export async function loadUnifiedCriteriaAsync(userEmail?: string): Promise<UnifiedCriteria> {
  // For user-specific queries, bypass cache
  if (userEmail && userEmail !== DEFAULT_USER) {
    return await loadCriteriaFromSQL(userEmail);
  }

  const now = Date.now();
  if (criteriaCache && (now - criteriaCacheTime) < CACHE_TTL) {
    return criteriaCache;
  }

  const criteria = await loadCriteriaFromSQL(userEmail || DEFAULT_USER);
  criteriaCache = criteria;
  criteriaCacheTime = now;
  return criteria;
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
 * Add a rule to the criteria (async, SQL-only).
 */
export async function addRuleAsync(
  domain: string,
  action: Action,
  userEmail?: string,
  subjectPattern?: string,
  subdomain?: string
): Promise<void> {
  await addRuleToSQL(domain, action, userEmail || DEFAULT_USER, subjectPattern, subdomain);
}

/**
 * Remove a rule from the criteria (async, SQL-only).
 * If removing the last rule for a domain, removes the domain entirely.
 */
export async function removeRuleAsync(
  domain: string,
  userEmail?: string,
  action?: Action,
  subjectPattern?: string,
  subdomain?: string
): Promise<boolean> {
  return await removeRuleFromSQL(domain, userEmail || DEFAULT_USER, action, subjectPattern, subdomain);
}

// Sync wrapper for backwards compatibility (fire-and-forget)
export function removeRule(
  domain: string,
  action?: Action,
  subjectPattern?: string,
  subdomain?: string,
  userEmail?: string
): boolean {
  removeRuleFromSQL(domain, userEmail || DEFAULT_USER, action, subjectPattern, subdomain).catch((err) =>
    console.error('Failed to remove rule from SQL:', err)
  );
  return true; // Optimistic return
}

/**
 * Update all rules for a domain (SQL-only).
 * This replaces the domain's rules entirely.
 */
export async function updateDomainRulesAsync(
  domain: string,
  rules: DomainRules,
  userEmail: string = DEFAULT_USER
): Promise<void> {
  const domainLower = domain.toLowerCase();

  // Get or create domain entry
  const criteriaId = await getOrCreateCriteria(domainLower, 'domain', userEmail);

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
  const addedPatterns: Record<string, string[]> = {};
  for (const action of patternTypes) {
    const patterns = rules[action] as string[] | undefined;
    if (patterns && patterns.length > 0) {
      addedPatterns[action] = [];
      for (const pattern of patterns) {
        await insert('patterns', {
          criteria_id: criteriaId,
          action,
          pattern,
        });
        addedPatterns[action].push(pattern);
      }
    }
  }

  // Audit log: domain rules updated
  await logAudit(userEmail, 'UPDATE', 'criteria', criteriaId, domainLower, {
    operation: 'update_domain_rules',
    new_default: rules.default || null,
    patterns_added: addedPatterns
  });

  // Invalidate cache
  criteriaCache = null;
}

/**
 * Delete all rules for a domain (SQL-only).
 */
export async function deleteDomainAsync(
  domain: string,
  userEmail: string = DEFAULT_USER
): Promise<boolean> {
  const domainLower = domain.toLowerCase();

  // Find the criteria entry for this domain
  const result = await queryAll<{ id: number }>(
    `SELECT id FROM criteria WHERE key_value = @domain AND key_type = 'domain' AND user_email = @userEmail`,
    { domain: domainLower, userEmail }
  );

  if (result.length === 0) {
    return false;
  }

  const criteriaId = result[0].id;

  // Delete patterns first
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

  // Audit log: domain deleted
  await logAudit(userEmail, 'DELETE', 'criteria', criteriaId, domainLower, {
    operation: 'delete_domain',
    key_type: 'domain'
  });

  // Invalidate cache
  criteriaCache = null;
  return true;
}

/**
 * Mark a domain/pattern as keep (SQL-aware with multi-user support).
 * Removes from delete/delete_1d/delete_10d lists and adds to keep.
 * Returns the number of delete rules removed.
 */
export async function markKeepAsync(
  domain: string,
  userEmail?: string,
  subjectPattern?: string
): Promise<{ removedCount: number; rules: DomainRules | null }> {
  const domainLower = domain.toLowerCase();
  const user = userEmail || DEFAULT_USER;
  let removedCount = 0;

  // Get criteria ID for this domain and user
  const result = await queryAll<{ id: number }>(
    `SELECT id FROM criteria WHERE key_value = @domain AND key_type = 'domain' AND user_email = @userEmail`,
    { domain: domainLower, userEmail: user }
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

      if (removedCount > 0) {
        await logAudit(user, 'DELETE', 'patterns', criteriaId, domainLower, {
          operation: 'mark_keep',
          removed_pattern: subjectPattern,
          removed_count: removedCount
        });
      }

      // Add to keep list (if not already there)
      const existing = await queryAll<{ id: number }>(
        `SELECT id FROM patterns
         WHERE criteria_id = @criteriaId
           AND action = 'keep'
           AND LOWER(pattern) = @pattern`,
        { criteriaId, pattern: patternLower }
      );
      if (existing.length === 0) {
        const keepId = await insert('patterns', {
          criteria_id: criteriaId,
          action: 'keep',
          pattern: subjectPattern,
        });

        await logAudit(user, 'INSERT', 'patterns', keepId, domainLower, {
          operation: 'mark_keep',
          action: 'keep',
          pattern: subjectPattern
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

      await logAudit(user, 'UPDATE', 'criteria', criteriaId, domainLower, {
        operation: 'mark_keep_all',
        removed_delete_patterns: removedCount,
        new_default: 'keep'
      });
    }
  } else {
    // Domain doesn't exist yet, create it with keep
    const criteriaId = await getOrCreateCriteria(domainLower, 'domain', user);
    if (subjectPattern) {
      const keepId = await insert('patterns', {
        criteria_id: criteriaId,
        action: 'keep',
        pattern: subjectPattern,
      });

      await logAudit(user, 'INSERT', 'patterns', keepId, domainLower, {
        operation: 'mark_keep_new_domain',
        action: 'keep',
        pattern: subjectPattern
      });
    } else {
      await query(
        `UPDATE criteria SET default_action = 'keep' WHERE id = @criteriaId`,
        { criteriaId }
      );

      await logAudit(user, 'UPDATE', 'criteria', criteriaId, domainLower, {
        operation: 'mark_keep_all_new_domain',
        new_default: 'keep'
      });
    }
  }

  // Invalidate cache
  criteriaCache = null;

  // Get updated rules from SQL
  const finalRules = await getDomainCriteriaAsync(domainLower, user);
  return { removedCount, rules: finalRules };
}

/**
 * Add exclude subjects to a domain.
 * NOTE: This is a legacy function - excludeSubjects are no longer actively used.
 */
export async function addExcludeSubjects(
  domain: string,
  terms: string[],
  userEmail: string = DEFAULT_USER
): Promise<void> {
  // This feature was deprecated - exclude subjects are handled via keep patterns now
  console.warn('addExcludeSubjects is deprecated - use keep patterns instead');
}

/**
 * Add an email pattern (fromEmails or toEmails) - SQL-only.
 */
export async function addEmailPattern(
  domain: string,
  direction: 'from' | 'to',
  action: 'keep' | 'delete',
  email: string,
  subdomain?: string,
  userEmail: string = DEFAULT_USER
): Promise<void> {
  const domainLower = domain.toLowerCase();
  const keyValue = subdomain || domainLower;

  const criteriaRow = await queryOne<CriteriaRow>(
    `SELECT id FROM criteria WHERE key_value = @keyValue AND user_email = @userEmail`,
    { keyValue, userEmail }
  );

  if (criteriaRow) {
    const emailPatternId = await insert('email_patterns', {
      criteria_id: criteriaRow.id,
      direction,
      action,
      email,
    });

    await logAudit(userEmail, 'INSERT', 'email_patterns', emailPatternId, domainLower, {
      direction,
      action,
      email,
      subdomain: subdomain || null
    });

    invalidateCache();
  }
}

/**
 * Remove an email pattern - SQL-only.
 */
export async function removeEmailPattern(
  domain: string,
  direction: 'from' | 'to',
  email: string,
  subdomain?: string,
  userEmail: string = DEFAULT_USER
): Promise<boolean> {
  const domainLower = domain.toLowerCase();
  const keyValue = subdomain || domainLower;

  const deleteResult = await query(
    `DELETE ep FROM email_patterns ep
     INNER JOIN criteria c ON ep.criteria_id = c.id
     WHERE c.key_value = @keyValue AND c.user_email = @userEmail AND ep.direction = @direction AND LOWER(ep.email) = LOWER(@email)`,
    { keyValue, userEmail, direction, email }
  );

  const removed = (deleteResult.rowsAffected?.[0] ?? 0) > 0;

  if (removed) {
    await logAudit(userEmail, 'DELETE', 'email_patterns', null, domainLower, {
      direction,
      email,
      subdomain: subdomain || null
    });
  }

  invalidateCache();
  return removed;
}

/**
 * Get all criteria (returns the unified criteria object).
 */
export function getAllCriteria(): UnifiedCriteria {
  return loadUnifiedCriteria();
}

/**
 * Get all criteria (async version with multi-user support).
 */
export async function getAllCriteriaAsync(userEmail?: string): Promise<UnifiedCriteria> {
  return loadUnifiedCriteriaAsync(userEmail);
}

/**
 * Get criteria for a specific domain.
 */
export function getDomainCriteria(domain: string): DomainRules | null {
  const criteria = loadUnifiedCriteria();
  return criteria[domain.toLowerCase()] || null;
}

/**
 * Get criteria for a specific domain (async version for SQL with multi-user support).
 */
export async function getDomainCriteriaAsync(domain: string, userEmail?: string): Promise<DomainRules | null> {
  const criteria = await loadUnifiedCriteriaAsync(userEmail);
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
 * Get statistics (async version for SQL with multi-user support).
 */
export async function getCriteriaStatsAsync(userEmail?: string): Promise<{
  totalDomains: number;
  withDefault: { delete: number; delete_1d: number; delete_10d: number; keep: number };
  withSubjectPatterns: number;
  withSubdomains: number;
  withExcludeSubjects: number;
  withEmailPatterns: number;
}> {
  return await getStatsFromSQL(userEmail || DEFAULT_USER);
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
