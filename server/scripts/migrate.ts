/**
 * Migration Script: Convert 3 criteria files to unified format
 *
 * Run with: npx tsx server/scripts/migrate.ts
 */

import fs from 'fs';
import path from 'path';

// Types for the new unified format
type Action = 'delete' | 'delete_1d' | 'keep';

interface DomainRules {
  default?: Action | null;
  excludeSubjects?: string[];
  keep?: string[];
  delete?: string[];
  delete_1d?: string[];
  subdomains?: { [subdomain: string]: DomainRules };
}

interface UnifiedCriteria {
  [primaryDomain: string]: DomainRules;
}

// Old format
interface OldCriteriaEntry {
  email: string;
  subdomain: string;
  primaryDomain: string;
  subject: string;
  toEmails: string;
  ccEmails: string;
  excludeSubject: string;
}

// Paths
const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const CRITERIA_FILE = path.join(PROJECT_ROOT, 'criteria.json');
const CRITERIA_1DAY_FILE = path.join(PROJECT_ROOT, 'criteria_1day_old.json');
const KEEP_CRITERIA_FILE = path.join(PROJECT_ROOT, 'keep_criteria.json');
const UNIFIED_FILE = path.join(PROJECT_ROOT, 'criteria_unified.json');

function loadJsonFile(filepath: string): OldCriteriaEntry[] {
  try {
    if (fs.existsSync(filepath)) {
      const content = fs.readFileSync(filepath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error(`Error loading ${filepath}:`, error);
  }
  return [];
}

function migrate(): void {
  console.log('=== Migrating Criteria Files to Unified Format ===\n');

  // Load all old files
  const deleteCriteria = loadJsonFile(CRITERIA_FILE);
  const delete1dCriteria = loadJsonFile(CRITERIA_1DAY_FILE);
  const keepCriteria = loadJsonFile(KEEP_CRITERIA_FILE);

  console.log(`Loaded: criteria.json (${deleteCriteria.length} entries)`);
  console.log(`Loaded: criteria_1day_old.json (${delete1dCriteria.length} entries)`);
  console.log(`Loaded: keep_criteria.json (${keepCriteria.length} entries)`);

  const unified: UnifiedCriteria = {};

  // Helper to ensure domain exists
  function ensureDomain(domain: string): DomainRules {
    if (!unified[domain]) {
      unified[domain] = {};
    }
    return unified[domain];
  }

  // Helper to add subject pattern to an action list
  function addSubjectPattern(rules: DomainRules, action: Action, subject: string): void {
    const key = action as 'keep' | 'delete' | 'delete_1d';
    if (!rules[key]) {
      rules[key] = [];
    }
    const lowerSubject = subject.toLowerCase();
    // Avoid duplicates
    if (!rules[key]!.some(s => s.toLowerCase() === lowerSubject)) {
      rules[key]!.push(subject);
    }
  }

  // Helper to add exclude subjects
  function addExcludeSubjects(rules: DomainRules, excludeSubject: string): void {
    if (!excludeSubject) return;
    const terms = excludeSubject.split(',').map(t => t.trim()).filter(t => t);
    if (terms.length === 0) return;

    if (!rules.excludeSubjects) {
      rules.excludeSubjects = [];
    }
    for (const term of terms) {
      const lowerTerm = term.toLowerCase();
      if (!rules.excludeSubjects.some(t => t.toLowerCase() === lowerTerm)) {
        rules.excludeSubjects.push(term);
      }
    }
  }

  // Process each type of criteria
  function processEntries(entries: OldCriteriaEntry[], action: Action): void {
    for (const entry of entries) {
      const domain = entry.primaryDomain.toLowerCase();
      if (!domain) continue;

      const rules = ensureDomain(domain);
      const subject = entry.subject?.trim() || '';
      const excludeSubject = entry.excludeSubject?.trim() || '';

      if (!subject) {
        // Domain-level rule (no subject filter)
        // Set as default action if not already set
        if (!rules.default) {
          rules.default = action;
        }
        // Merge exclude subjects
        addExcludeSubjects(rules, excludeSubject);
      } else {
        // Subject-specific rule
        addSubjectPattern(rules, action, subject);
        // Note: excludeSubject on subject-specific entries is rare, but handle it
        if (excludeSubject) {
          addExcludeSubjects(rules, excludeSubject);
        }
      }
    }
  }

  // Process in priority order: keep > delete > delete_1d
  // Keep entries take precedence
  console.log('\nProcessing keep_criteria.json...');
  processEntries(keepCriteria, 'keep');

  console.log('Processing criteria.json...');
  processEntries(deleteCriteria, 'delete');

  console.log('Processing criteria_1day_old.json...');
  processEntries(delete1dCriteria, 'delete_1d');

  // Handle subdomain detection
  // Check if any domain is actually a subdomain of another domain
  const allDomains = Object.keys(unified);
  for (const fullDomain of allDomains) {
    // Skip if it's a simple domain (2 parts or less for .com, 3 for .co.in)
    const parts = fullDomain.split('.');

    // Determine if this might be a subdomain
    // e.g., alerts.sbi.co.in -> parent is sbi.co.in
    // e.g., custcomm.icicibank.com -> parent is icicibank.com
    let parentDomain: string | null = null;

    if (parts.length >= 4 && parts[parts.length - 2] === 'co') {
      // e.g., alerts.sbi.co.in -> sbi.co.in
      parentDomain = parts.slice(1).join('.');
    } else if (parts.length >= 3 && parts[parts.length - 2] !== 'co') {
      // e.g., custcomm.icicibank.com -> icicibank.com
      parentDomain = parts.slice(1).join('.');
    }

    if (parentDomain && unified[parentDomain]) {
      // This is a subdomain of an existing domain
      // Move its rules under the parent's subdomains
      const parentRules = unified[parentDomain];
      if (!parentRules.subdomains) {
        parentRules.subdomains = {};
      }
      parentRules.subdomains[fullDomain] = unified[fullDomain];
      delete unified[fullDomain];
      console.log(`  Moved ${fullDomain} under ${parentDomain}.subdomains`);
    }
  }

  // Clean up: remove empty arrays and null values
  for (const domain of Object.keys(unified)) {
    const rules = unified[domain];
    if (rules.keep?.length === 0) delete rules.keep;
    if (rules.delete?.length === 0) delete rules.delete;
    if (rules.delete_1d?.length === 0) delete rules.delete_1d;
    if (rules.excludeSubjects?.length === 0) delete rules.excludeSubjects;
  }

  // Sort domains alphabetically
  const sortedUnified: UnifiedCriteria = {};
  for (const domain of Object.keys(unified).sort()) {
    sortedUnified[domain] = unified[domain];
  }

  // Write the unified file
  fs.writeFileSync(UNIFIED_FILE, JSON.stringify(sortedUnified, null, 2), 'utf-8');

  console.log(`\n=== Migration Complete ===`);
  console.log(`Output: ${UNIFIED_FILE}`);
  console.log(`Total domains: ${Object.keys(sortedUnified).length}`);

  // Stats
  let withSubdomains = 0;
  let withSubjectPatterns = 0;
  let domainLevelOnly = 0;

  for (const rules of Object.values(sortedUnified)) {
    if (rules.subdomains && Object.keys(rules.subdomains).length > 0) withSubdomains++;
    if (rules.keep?.length || rules.delete?.length || rules.delete_1d?.length) withSubjectPatterns++;
    if (rules.default && !rules.keep?.length && !rules.delete?.length && !rules.delete_1d?.length) domainLevelOnly++;
  }

  console.log(`  - With subdomains: ${withSubdomains}`);
  console.log(`  - With subject patterns: ${withSubjectPatterns}`);
  console.log(`  - Domain-level only: ${domainLevelOnly}`);
}

migrate();
