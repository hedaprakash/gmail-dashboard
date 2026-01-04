/**
 * Cache Service
 *
 * Handles caching of email data to avoid repeated Gmail API calls.
 */

import fs from 'fs';
import path from 'path';
import type { EmailData, DomainGroup, SubdomainGroup, EmailPattern } from '../types/index.js';
import { matchEmail } from './criteria.js';

const PROJECT_ROOT = process.cwd();
const LOGS_DIR = path.join(PROJECT_ROOT, 'logs');
const CACHE_PATTERN = 'emails_categorized_*.json';
const CACHE_MAX_AGE_HOURS = 5;

/**
 * Find the most recent cached JSON file and check its age.
 */
export function findCachedJson(): { filepath: string; ageHours: number } | null {
  if (!fs.existsSync(LOGS_DIR)) {
    return null;
  }

  const files = fs.readdirSync(LOGS_DIR)
    .filter(f => f.startsWith('emails_categorized_') && f.endsWith('.json'))
    .map(f => ({
      name: f,
      path: path.join(LOGS_DIR, f),
      mtime: fs.statSync(path.join(LOGS_DIR, f)).mtime.getTime()
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    return null;
  }

  const mostRecent = files[0];
  if (!mostRecent) return null;

  const ageHours = (Date.now() - mostRecent.mtime) / (1000 * 60 * 60);

  return {
    filepath: mostRecent.path,
    ageHours
  };
}

/**
 * Load emails from cached JSON file.
 */
export function loadCachedEmails(cachePath: string): EmailData[] {
  console.log(`Loading cached data from ${cachePath}`);
  const content = fs.readFileSync(cachePath, 'utf-8');
  return JSON.parse(content) as EmailData[];
}

/**
 * Save emails to cache.
 */
export function saveCachedEmails(emails: EmailData[]): string {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  const cachePath = path.join(LOGS_DIR, `emails_categorized_${timestamp}.json`);

  fs.writeFileSync(cachePath, JSON.stringify(emails, null, 2), 'utf-8');
  console.log(`Saved ${emails.length} emails to cache: ${cachePath}`);

  return cachePath;
}

/**
 * Check if cache should be refreshed.
 */
export function shouldRefreshCache(): boolean {
  const cache = findCachedJson();
  if (!cache) {
    return true;
  }
  return cache.ageHours > CACHE_MAX_AGE_HOURS;
}

/**
 * Extract sender (local part) from email address.
 */
function extractSender(emailAddress: string): string {
  if (!emailAddress || !emailAddress.includes('@')) {
    return '';
  }
  return emailAddress.split('@')[0] ?? '';
}

/**
 * Get display name for subdomain relative to primary domain.
 */
function getSubdomainDisplayName(subdomain: string, primaryDomain: string): string {
  if (!subdomain || subdomain === primaryDomain) {
    return '(direct)';
  }
  // Remove the primary domain suffix to show just the subdomain part
  if (subdomain.endsWith(primaryDomain)) {
    const prefix = subdomain.slice(0, -(primaryDomain.length + 1)); // +1 for the dot
    return prefix || '(direct)';
  }
  return subdomain;
}

/**
 * Group emails by domain > subdomain > sender > subject pattern.
 */
export function groupEmailsByPattern(emailDetails: EmailData[]): DomainGroup[] {
  // Structure: domain -> subdomain -> patternKey -> pattern data
  const grouped: Record<string, Record<string, Record<string, {
    subject: string;
    sender: string;
    category: string;
    categoryIcon: string;
    categoryColor: string;
    categoryBg: string;
    count: number;
    emails: EmailData[];
    minDate: Date;
    maxDate: Date;
    messageIds: string[];
  }>>> = {};

  for (const email of emailDetails) {
    const primaryDomain = email.primaryDomain || 'unknown';
    const subdomain = email.subdomain || primaryDomain;
    const sender = extractSender(email.email);
    const subject = email.subject.slice(0, 50);
    const category = email.category || 'UNKNOWN';
    const patternKey = `${sender}:${category}:${subject}`;

    // Initialize nested structures
    if (!grouped[primaryDomain]) {
      grouped[primaryDomain] = {};
    }
    if (!grouped[primaryDomain][subdomain]) {
      grouped[primaryDomain][subdomain] = {};
    }

    if (!grouped[primaryDomain][subdomain][patternKey]) {
      grouped[primaryDomain][subdomain][patternKey] = {
        subject,
        sender,
        category,
        categoryIcon: email.categoryIcon || '🟡',
        categoryColor: email.categoryColor || '#ffc107',
        categoryBg: email.categoryBg || '#fff3cd',
        count: 0,
        emails: [],
        minDate: new Date(email.date),
        maxDate: new Date(email.date),
        messageIds: []
      };
    }

    const group = grouped[primaryDomain][subdomain][patternKey]!;
    group.count++;
    group.emails.push(email);
    group.messageIds.push(email.id);

    const emailDate = new Date(email.date);
    if (emailDate < group.minDate) {
      group.minDate = emailDate;
    }
    if (emailDate > group.maxDate) {
      group.maxDate = emailDate;
    }
  }

  // Convert to DomainGroup array with subdomain hierarchy
  const result: DomainGroup[] = [];

  for (const [primaryDomain, subdomains] of Object.entries(grouped)) {
    const subdomainGroups: SubdomainGroup[] = [];
    const allPatterns: EmailPattern[] = [];

    for (const [subdomain, patterns] of Object.entries(subdomains)) {
      const patternList: EmailPattern[] = [];

      for (const pattern of Object.values(patterns)) {
        const emailPattern: EmailPattern = {
          domain: primaryDomain,
          subdomain,
          sender: pattern.sender,
          subject: pattern.subject,
          category: pattern.category,
          count: pattern.count,
          minDate: pattern.minDate.toISOString(),
          maxDate: pattern.maxDate.toISOString(),
          messageIds: pattern.messageIds,
          categoryIcon: pattern.categoryIcon,
          categoryColor: pattern.categoryColor,
          categoryBg: pattern.categoryBg
        };
        patternList.push(emailPattern);
        allPatterns.push(emailPattern);
      }

      // Sort patterns by count
      patternList.sort((a, b) => b.count - a.count);

      subdomainGroups.push({
        subdomain,
        displayName: getSubdomainDisplayName(subdomain, primaryDomain),
        totalEmails: patternList.reduce((sum, p) => sum + p.count, 0),
        patterns: patternList
      });
    }

    // Sort subdomains by email count
    subdomainGroups.sort((a, b) => b.totalEmails - a.totalEmails);

    result.push({
      domain: primaryDomain,
      totalEmails: allPatterns.reduce((sum, p) => sum + p.count, 0),
      subdomains: subdomainGroups,
      patterns: allPatterns
    });
  }

  // Sort domains by total email count
  result.sort((a, b) => b.totalEmails - a.totalEmails);

  return result;
}

/**
 * Filter out emails that already have a decision:
 * - Matches delete criteria (will be deleted)
 * - Matches keep criteria (will be kept)
 * - Any action assigned by the unified criteria
 */
export function filterDecidedEmails(
  emails: EmailData[]
): { filtered: EmailData[]; removedCount: number } {
  const filtered: EmailData[] = [];
  let removedCount = 0;

  for (const email of emails) {
    const result = matchEmail(email);

    // If matchEmail returns an action, the email has a decision
    if (result.action !== null) {
      removedCount++;
    } else {
      filtered.push(email);
    }
  }

  return { filtered, removedCount };
}

/**
 * Get cache stats.
 */
export function getCacheStats(): {
  hasCached: boolean;
  filepath?: string;
  ageHours?: number;
  emailCount?: number;
} {
  const cache = findCachedJson();
  if (!cache) {
    return { hasCached: false };
  }

  try {
    const emails = loadCachedEmails(cache.filepath);
    return {
      hasCached: true,
      filepath: cache.filepath,
      ageHours: cache.ageHours,
      emailCount: emails.length
    };
  } catch {
    return {
      hasCached: true,
      filepath: cache.filepath,
      ageHours: cache.ageHours
    };
  }
}
