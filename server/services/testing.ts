/**
 * Testing Service V2
 *
 * Real-world simulation of Review page actions with test emails.
 * Each test shows From/To/Subject just like the Review page.
 */

import { queryOne } from './database.js';

// Test user email - never used in real OAuth flow
export const TEST_USER_EMAIL = 'test-scenarios@test.local';

// ============================================================================
// Types
// ============================================================================

export type ButtonType = 'keep' | 'delete' | 'delete_1d' | 'delete_10d' | 'keep_all' | 'del_all';

export interface TestScenario {
  id: string;
  description: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  selectText?: string;  // Text to highlight/select before clicking (for pattern tests)
  clickButton: ButtonType;
  expectedOutcome: string;
}

export interface SqlCounts {
  criteria: number;
  patterns: number;
  email_patterns: number;
  audit_log: number;
}

export interface SqlResult {
  criteria: number;
  patterns: number;
  email_patterns: number;
  audit_log: number;
}

export interface ApiResult {
  success: boolean;
  message: string;
  responseTime: number;
  statusCode?: number;
  body?: unknown;
}

export interface TestResult {
  scenarioId: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  apiResult?: ApiResult;
  sqlResult?: SqlResult;
  error?: string;
}

export interface LogEntry {
  timestamp: string;
  type: 'test-start' | 'api-request' | 'api-response' | 'sql-query' | 'sql-result' | 'pass' | 'fail' | 'info' | 'error';
  testId?: string;
  message: string;
  details?: string;
}

// ============================================================================
// Test Scenarios Definition (V2 - Email Format)
// ============================================================================

export const TEST_SCENARIOS: TestScenario[] = [
  // === Domain Operations (T01-T04) ===
  {
    id: 'T01',
    description: 'Delete a domain',
    fromEmail: 'sender@testdomain-01.com',
    toEmail: 'testuser@test.local',
    subject: 'Sample Email Subject',
    clickButton: 'delete',
    expectedOutcome: 'Domain testdomain-01.com → delete'
  },
  {
    id: 'T02',
    description: 'Delete 1D domain (protect OTPs)',
    fromEmail: 'sender@testdomain-02.com',
    toEmail: 'testuser@test.local',
    subject: 'Your verification code',
    clickButton: 'delete_1d',
    expectedOutcome: 'Domain testdomain-02.com → delete_1d'
  },
  {
    id: 'T03',
    description: 'Delete 10D domain (monthly reports)',
    fromEmail: 'sender@testdomain-03.com',
    toEmail: 'testuser@test.local',
    subject: 'Monthly Analytics Report',
    clickButton: 'delete_10d',
    expectedOutcome: 'Domain testdomain-03.com → delete_10d'
  },
  {
    id: 'T04',
    description: 'Keep All for important domain',
    fromEmail: 'ceo@testdomain-04.com',
    toEmail: 'testuser@test.local',
    subject: 'Quarterly Review Meeting',
    clickButton: 'keep_all',
    expectedOutcome: 'Domain testdomain-04.com → keep'
  },

  // === Subject Pattern Operations (T05-T08) ===
  {
    id: 'T05',
    description: 'Delete with pattern selection',
    fromEmail: 'news@testdomain-05.com',
    toEmail: 'testuser@test.local',
    subject: 'Weekly Newsletter Digest',
    selectText: 'Newsletter',
    clickButton: 'delete',
    expectedOutcome: 'Pattern "Newsletter" → delete'
  },
  {
    id: 'T06',
    description: 'Delete 1D with pattern (OTP codes)',
    fromEmail: 'alerts@testdomain-06.com',
    toEmail: 'testuser@test.local',
    subject: 'Your Verification Code is 123456',
    selectText: 'Verification Code',
    clickButton: 'delete_1d',
    expectedOutcome: 'Pattern "Verification Code" → delete_1d'
  },
  {
    id: 'T07',
    description: 'Delete 10D with pattern',
    fromEmail: 'reports@testdomain-07.com',
    toEmail: 'testuser@test.local',
    subject: 'Monthly Report - December 2024',
    selectText: 'Monthly Report',
    clickButton: 'delete_10d',
    expectedOutcome: 'Pattern "Monthly Report" → delete_10d'
  },
  {
    id: 'T08',
    description: 'Keep with pattern selection',
    fromEmail: 'billing@testdomain-08.com',
    toEmail: 'testuser@test.local',
    subject: 'Payment Received - Invoice #12345',
    selectText: 'Payment Received',
    clickButton: 'keep',
    expectedOutcome: 'Pattern "Payment Received" → keep'
  },

  // === Subdomain Operations (T09-T12) ===
  {
    id: 'T09',
    description: 'Delete subdomain',
    fromEmail: 'sender@mail.testdomain-09.com',
    toEmail: 'testuser@test.local',
    subject: 'Email from mail subdomain',
    clickButton: 'delete',
    expectedOutcome: 'Subdomain mail.testdomain-09.com → delete'
  },
  {
    id: 'T10',
    description: 'Delete 1D subdomain',
    fromEmail: 'sender@news.testdomain-10.com',
    toEmail: 'testuser@test.local',
    subject: 'News update from subdomain',
    clickButton: 'delete_1d',
    expectedOutcome: 'Subdomain news.testdomain-10.com → delete_1d'
  },
  {
    id: 'T11',
    description: 'Delete 10D subdomain',
    fromEmail: 'sender@promo.testdomain-11.com',
    toEmail: 'testuser@test.local',
    subject: 'Special promotional offer',
    clickButton: 'delete_10d',
    expectedOutcome: 'Subdomain promo.testdomain-11.com → delete_10d'
  },
  {
    id: 'T12',
    description: 'Keep All subdomain',
    fromEmail: 'sender@alerts.testdomain-12.com',
    toEmail: 'testuser@test.local',
    subject: 'Important security alert',
    clickButton: 'keep_all',
    expectedOutcome: 'Subdomain alerts.testdomain-12.com → keep'
  },

  // === Del All / Keep All Operations (T13-T16) ===
  {
    id: 'T13',
    description: 'Del All for spam domain',
    fromEmail: 'spam@testdomain-13.com',
    toEmail: 'testuser@test.local',
    subject: 'Amazing Deal - 80% Off!!!',
    clickButton: 'del_all',
    expectedOutcome: 'Domain testdomain-13.com → delete'
  },
  {
    id: 'T14',
    description: 'Delete 1D - protect recent messages',
    fromEmail: 'noreply@testdomain-14.com',
    toEmail: 'testuser@test.local',
    subject: 'Auto-generated message',
    clickButton: 'delete_1d',
    expectedOutcome: 'Domain testdomain-14.com → delete_1d'
  },
  {
    id: 'T15',
    description: 'Delete 10D - keep for archival',
    fromEmail: 'system@testdomain-15.com',
    toEmail: 'testuser@test.local',
    subject: 'System notification',
    clickButton: 'delete_10d',
    expectedOutcome: 'Domain testdomain-15.com → delete_10d'
  },
  {
    id: 'T16',
    description: 'Keep All for VIP domain',
    fromEmail: 'vip@testdomain-16.com',
    toEmail: 'testuser@test.local',
    subject: 'Important VIP message',
    clickButton: 'keep_all',
    expectedOutcome: 'Domain testdomain-16.com → keep'
  },

  // === Edge Cases (T17-T20) ===
  {
    id: 'T17',
    description: 'Long email and subject',
    fromEmail: 'very-long-sender-name@very-long-domain-name-example.com',
    toEmail: 'testuser@test.local',
    subject: 'This is a very long subject line that should wrap to multiple lines in the UI to test layout handling',
    clickButton: 'delete',
    expectedOutcome: 'Domain very-long-domain-name-example.com → delete'
  },
  {
    id: 'T18',
    description: 'Special characters in email',
    fromEmail: 'special+chars@test-domain-18.com',
    toEmail: 'testuser@test.local',
    subject: 'Subject with "quotes" & symbols! @#$%',
    clickButton: 'delete',
    expectedOutcome: 'Domain test-domain-18.com → delete'
  },
  {
    id: 'T19',
    description: 'Case sensitivity test',
    fromEmail: 'UPPERCASE@TESTDOMAIN-19.COM',
    toEmail: 'testuser@test.local',
    subject: 'UPPERCASE SUBJECT LINE',
    clickButton: 'delete',
    expectedOutcome: 'Domain testdomain-19.com → delete (lowercase)'
  },
  {
    id: 'T20',
    description: 'Unicode characters',
    fromEmail: 'sender@testdomain-20.com',
    toEmail: 'testuser@test.local',
    subject: 'Unicode subject: Café résumé naïve',
    clickButton: 'delete',
    expectedOutcome: 'Domain testdomain-20.com → delete'
  }
];

// ============================================================================
// SQL Count Functions
// ============================================================================

/**
 * Get current SQL row counts for the test user.
 */
export async function getSqlCounts(userEmail: string = TEST_USER_EMAIL): Promise<SqlCounts> {
  const result = await queryOne<{
    criteria_count: number;
    patterns_count: number;
    email_patterns_count: number;
    audit_log_count: number;
  }>('EXEC dbo.GetTestSqlCounts @UserEmail = @userEmail', { userEmail });

  return {
    criteria: result?.criteria_count || 0,
    patterns: result?.patterns_count || 0,
    email_patterns: result?.email_patterns_count || 0,
    audit_log: result?.audit_log_count || 0
  };
}

/**
 * Clear all test data for the test user.
 */
export async function clearTestData(userEmail: string = TEST_USER_EMAIL): Promise<{
  success: boolean;
  message: string;
  cleared: SqlCounts;
}> {
  const result = await queryOne<{
    success: number;
    message: string;
    criteria_deleted: number;
    patterns_deleted: number;
    email_patterns_deleted: number;
    audit_log_deleted: number;
  }>('EXEC dbo.ClearTestScenarioData @UserEmail = @userEmail', { userEmail });

  return {
    success: result?.success === 1,
    message: result?.message || 'Unknown error',
    cleared: {
      criteria: result?.criteria_deleted || 0,
      patterns: result?.patterns_deleted || 0,
      email_patterns: result?.email_patterns_deleted || 0,
      audit_log: result?.audit_log_deleted || 0
    }
  };
}

// ============================================================================
// Test Execution Functions
// ============================================================================

/**
 * Determine if fromEmail is a subdomain.
 * Returns the subdomain if found, undefined otherwise.
 */
function getSubdomainFromEmail(email: string): string | undefined {
  const match = email.match(/@([^.]+)\.([^.]+\.[^.]+)$/);
  if (match && match[1]) {
    return match[1];  // e.g., 'mail' from 'sender@mail.example.com'
  }
  return undefined;
}

/**
 * Extract domain from email address.
 * E.g., "sender@mail.example.com" -> "mail.example.com"
 */
function getDomainFromEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex === -1) return email;
  return email.slice(atIndex + 1).toLowerCase();
}

/**
 * Build the API endpoint and body for a test scenario.
 * Matches exactly how Review page calls the API.
 */
function buildApiRequest(scenario: TestScenario): { endpoint: string; body: Record<string, unknown> } {
  // Determine level based on fromEmail structure
  const subdomain = getSubdomainFromEmail(scenario.fromEmail);
  const level = subdomain ? 'subdomain' : 'domain';

  // Determine endpoint based on button clicked
  let endpoint: string;
  let body: Record<string, unknown>;

  switch (scenario.clickButton) {
    case 'keep':
    case 'keep_all':
      // mark-keep endpoint expects 'domain' and 'subject_pattern'
      endpoint = '/api/actions/mark-keep';
      body = {
        domain: getDomainFromEmail(scenario.fromEmail),
        subject_pattern: scenario.selectText || '',
        category: 'TEST'
      };
      break;
    case 'delete':
    case 'del_all':
      endpoint = '/api/actions/add-criteria';
      body = {
        fromEmail: scenario.fromEmail,
        subject: scenario.subject,
        level,
        subject_pattern: scenario.selectText
      };
      break;
    case 'delete_1d':
      endpoint = '/api/actions/add-criteria-1d';
      body = {
        fromEmail: scenario.fromEmail,
        subject: scenario.subject,
        level,
        subject_pattern: scenario.selectText
      };
      break;
    case 'delete_10d':
      endpoint = '/api/actions/add-criteria-10d';
      body = {
        fromEmail: scenario.fromEmail,
        subject: scenario.subject,
        level,
        subject_pattern: scenario.selectText
      };
      break;
    default:
      endpoint = '/api/actions/add-criteria';
      body = {
        fromEmail: scenario.fromEmail,
        subject: scenario.subject,
        level,
        subject_pattern: scenario.selectText
      };
  }

  return { endpoint, body };
}

/**
 * Execute a single test scenario and return results.
 */
export async function executeTestScenario(
  scenario: TestScenario,
  baseUrl: string = 'http://localhost:5000',
  onLog?: (entry: LogEntry) => void
): Promise<TestResult> {
  const result: TestResult = {
    scenarioId: scenario.id,
    status: 'running'
  };

  const log = (entry: Omit<LogEntry, 'timestamp'>) => {
    if (onLog) {
      onLog({
        ...entry,
        timestamp: new Date().toISOString(),
        testId: scenario.id
      });
    }
  };

  try {
    log({ type: 'test-start', message: `TEST ${scenario.id}: ${scenario.description}` });

    // Get SQL counts before
    log({ type: 'sql-query', message: 'Getting SQL counts before...' });
    const countsBefore = await getSqlCounts();
    log({
      type: 'sql-result',
      message: `Before: criteria=${countsBefore.criteria}, patterns=${countsBefore.patterns}, audit=${countsBefore.audit_log}`
    });

    // Build and execute API request
    const { endpoint, body } = buildApiRequest(scenario);
    log({
      type: 'api-request',
      message: `POST ${endpoint}`,
      details: JSON.stringify(body, null, 2)
    });

    const startTime = Date.now();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Test-User': TEST_USER_EMAIL
    };

    // Include API key if available
    const apiKey = process.env.API_KEY;
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    const responseTime = Date.now() - startTime;
    const responseBody = await response.json() as { success?: boolean; message?: string; [key: string]: unknown };

    log({
      type: 'api-response',
      message: `${response.status} ${response.statusText} (${responseTime}ms)`,
      details: JSON.stringify(responseBody, null, 2)
    });

    result.apiResult = {
      success: response.ok && (responseBody.success === true),
      message: responseBody.message || (response.ok ? 'Success' : 'Failed'),
      responseTime,
      statusCode: response.status,
      body: responseBody
    };

    // Get SQL counts after
    log({ type: 'sql-query', message: 'Getting SQL counts after...' });
    const countsAfter = await getSqlCounts();
    log({
      type: 'sql-result',
      message: `After: criteria=${countsAfter.criteria}, patterns=${countsAfter.patterns}, audit=${countsAfter.audit_log}`
    });

    // Calculate diff
    result.sqlResult = {
      criteria: countsAfter.criteria - countsBefore.criteria,
      patterns: countsAfter.patterns - countsBefore.patterns,
      email_patterns: countsAfter.email_patterns - countsBefore.email_patterns,
      audit_log: countsAfter.audit_log - countsBefore.audit_log
    };

    // Determine pass/fail
    if (result.apiResult.success) {
      result.status = 'passed';
      log({
        type: 'pass',
        message: `TEST ${scenario.id} PASSED`,
        details: `SQL: criteria ${result.sqlResult.criteria >= 0 ? '+' : ''}${result.sqlResult.criteria}, patterns ${result.sqlResult.patterns >= 0 ? '+' : ''}${result.sqlResult.patterns}, audit ${result.sqlResult.audit_log >= 0 ? '+' : ''}${result.sqlResult.audit_log}`
      });
    } else {
      result.status = 'failed';
      result.error = result.apiResult.message;
      log({
        type: 'fail',
        message: `TEST ${scenario.id} FAILED: ${result.apiResult.message}`
      });
    }

  } catch (error) {
    result.status = 'failed';
    result.error = error instanceof Error ? error.message : 'Unknown error';
    log({
      type: 'error',
      message: `TEST ${scenario.id} ERROR: ${result.error}`
    });
  }

  return result;
}

/**
 * Get all test scenarios.
 */
export function getTestScenarios(): TestScenario[] {
  return TEST_SCENARIOS;
}

/**
 * Get a single test scenario by ID.
 */
export function getTestScenarioById(id: string): TestScenario | undefined {
  return TEST_SCENARIOS.find(s => s.id === id);
}
