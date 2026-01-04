/**
 * Action Logger
 *
 * Logs all user actions (keep, delete, delete1d) to a single log file.
 * Format: timestamp | action | domain | subject | details
 */

import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const LOGS_DIR = path.join(PROJECT_ROOT, 'logs');
const ACTION_LOG_FILE = path.join(LOGS_DIR, 'actions.log');

type ActionType = 'KEEP' | 'DELETE' | 'DELETE_1D' | 'DELETE_10D' | 'KEEP_ALL' | 'DELETE_ALL' | 'DELETE_1D_ALL' | 'DELETE_10D_ALL' | 'UNDO';

interface LogEntry {
  action: ActionType;
  domain: string;
  subject?: string;
  category?: string;
  details?: string;
}

/**
 * Ensure logs directory exists
 */
function ensureLogsDir(): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/**
 * Format timestamp for log entry
 */
function formatTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Log an action to the actions.log file
 */
export function logAction(entry: LogEntry): void {
  ensureLogsDir();

  const timestamp = formatTimestamp();
  const subject = entry.subject ? `"${entry.subject}"` : '(all)';
  const details = entry.details || '';
  const category = entry.category ? `[${entry.category}]` : '';

  const logLine = `${timestamp} | ${entry.action.padEnd(12)} | ${entry.domain.padEnd(30)} | ${subject} ${category} ${details}\n`;

  fs.appendFileSync(ACTION_LOG_FILE, logLine, 'utf-8');
}

/**
 * Log a KEEP action
 */
export function logKeep(domain: string, subject: string, category?: string, removedFromDelete?: number): void {
  const details = removedFromDelete && removedFromDelete > 0
    ? `(removed ${removedFromDelete} from delete criteria)`
    : '';

  logAction({
    action: subject ? 'KEEP' : 'KEEP_ALL',
    domain,
    subject: subject || undefined,
    category,
    details
  });
}

/**
 * Log a DELETE action
 */
export function logDelete(domain: string, subject: string): void {
  logAction({
    action: subject ? 'DELETE' : 'DELETE_ALL',
    domain,
    subject: subject || undefined
  });
}

/**
 * Log a DELETE_1D action
 */
export function logDelete1d(domain: string, subject: string): void {
  logAction({
    action: subject ? 'DELETE_1D' : 'DELETE_1D_ALL',
    domain,
    subject: subject || undefined
  });
}

/**
 * Log a DELETE_10D action
 */
export function logDelete10d(domain: string, subject: string): void {
  logAction({
    action: subject ? 'DELETE_10D' : 'DELETE_10D_ALL',
    domain,
    subject: subject || undefined
  });
}

/**
 * Log an UNDO action
 */
export function logUndo(domain: string, subject: string, fileType: string): void {
  logAction({
    action: 'UNDO',
    domain,
    subject: subject || undefined,
    details: `(from ${fileType})`
  });
}
