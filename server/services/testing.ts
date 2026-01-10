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
// Test Scenarios Definition (V3 - Based on Real Gmail Emails)
// ============================================================================
// These test scenarios are based on real Gmail email patterns with only the
// domain changed to test domains. The fromEmail uses the extracted email
// address (not the full From header), matching real Gmail API data structure.
// ============================================================================

export const TEST_SCENARIOS: TestScenario[] = [
  // === Domain Operations (T01-T04) - Based on Real Promotional Emails ===
  {
    id: 'T01',
    description: 'Delete promo domain (Tracfone pattern)',
    // Real email: TracFone@email2.tracfone.com
    fromEmail: 'TracFone@email2.testdomain-01.com',
    toEmail: 'sqlfeatures@gmail.com',
    subject: 'Quick! Join Rewards for 200 points now!',  // Real subject
    clickButton: 'delete',
    expectedOutcome: 'Domain testdomain-01.com → delete'
  },
  {
    id: 'T02',
    description: 'Delete 1D verification (TikTok pattern)',
    // Real email: noreply@account.tiktok.com
    fromEmail: 'noreply@account.testdomain-02.com',
    toEmail: 'sqlfeatures@gmail.com',
    subject: '235614 is your verification code',  // Real subject
    clickButton: 'delete_1d',
    expectedOutcome: 'Domain testdomain-02.com → delete_1d'
  },
  {
    id: 'T03',
    description: 'Delete 10D statement (Google Fi pattern)',
    // Real email: payments-noreply@google.com
    fromEmail: 'payments-noreply@testdomain-03.com',
    toEmail: 'sqlfeatures@gmail.com',
    subject: 'Your Google Fi monthly statement',  // Real subject
    clickButton: 'delete_10d',
    expectedOutcome: 'Domain testdomain-03.com → delete_10d'
  },
  {
    id: 'T04',
    description: 'Keep All security alerts (Google pattern)',
    // Real email: no-reply@accounts.google.com
    fromEmail: 'no-reply@accounts.testdomain-04.com',
    toEmail: 'sqlfeatures@gmail.com',
    subject: 'Security alert',  // Real subject
    clickButton: 'keep_all',
    expectedOutcome: 'Domain testdomain-04.com → keep'
  },

  // === Subject Pattern Operations (T05-T08) - Based on Real Patterns ===
  {
    id: 'T05',
    description: 'Delete newsletter pattern (TubeBuddy pattern)',
    // Real email: hello@tubebuddy.com
    fromEmail: 'hello@testdomain-05.com',
    toEmail: 'sqlfeatures@gmail.com',
    subject: 'We Have Some Insights For You',  // Real subject
    selectText: 'Insights',
    clickButton: 'delete',
    expectedOutcome: 'Pattern "Insights" → delete'
  },
  {
    id: 'T06',
    description: 'Delete 1D verification pattern',
    // Real email: TracFone@email2.tracfone.com
    fromEmail: 'TracFone@email2.testdomain-06.com',
    toEmail: 'sqlfeatures@gmail.com',
    subject: 'Your Tracfone Verification code',  // Real subject
    selectText: 'Verification code',
    clickButton: 'delete_1d',
    expectedOutcome: 'Pattern "Verification code" → delete_1d'
  },
  {
    id: 'T07',
    description: 'Delete 10D monthly pattern',
    // Real email: payments-noreply@google.com
    fromEmail: 'payments-noreply@testdomain-07.com',
    toEmail: 'sqlfeatures@gmail.com',
    subject: 'Your Project Fi monthly statement',  // Real subject
    selectText: 'monthly statement',
    clickButton: 'delete_10d',
    expectedOutcome: 'Pattern "monthly statement" → delete_10d'
  },
  {
    id: 'T08',
    description: 'Keep receipt pattern',
    // Real email: projectfi-noreply@google.com
    fromEmail: 'projectfi-noreply@testdomain-08.com',
    toEmail: 'sqlfeatures@gmail.com',
    subject: 'Your Project Fi Order Receipt from Mar 20, 2018',  // Real subject
    selectText: 'Order Receipt',
    clickButton: 'keep',
    expectedOutcome: 'Pattern "Order Receipt" → keep'
  },

  // === Subdomain Operations (T09-T12) - Based on Real Subdomains ===
  {
    id: 'T09',
    description: 'Delete email2 subdomain (Tracfone pattern)',
    // Real email: TracFone@email2.tracfone.com
    fromEmail: 'TracFone@email2.testdomain-09.com',
    toEmail: 'sqlfeatures@gmail.com',
    subject: 'Introducing a new plan with truly unlimited data',  // Real subject
    clickButton: 'delete',
    expectedOutcome: 'Subdomain email2.testdomain-09.com → delete'
  },
  {
    id: 'T10',
    description: 'Delete 1D account subdomain (TikTok pattern)',
    // Real email: noreply@account.tiktok.com
    fromEmail: 'noreply@account.testdomain-10.com',
    toEmail: 'sqlfeatures@gmail.com',
    subject: '847291 is your verification code',  // Real pattern
    clickButton: 'delete_1d',
    expectedOutcome: 'Subdomain account.testdomain-10.com → delete_1d'
  },
  {
    id: 'T11',
    description: 'Delete 10D emails subdomain (Thanx pattern)',
    // Real email: thanxapp@emails.thanx.com
    fromEmail: 'thanxapp@emails.testdomain-11.com',
    toEmail: 'sqlfeatures@gmail.com',
    subject: 'Future of the Thanx app.',  // Real subject
    clickButton: 'delete_10d',
    expectedOutcome: 'Subdomain emails.testdomain-11.com → delete_10d'
  },
  {
    id: 'T12',
    description: 'Keep All accounts subdomain (Google pattern)',
    // Real email: no-reply@accounts.google.com
    fromEmail: 'no-reply@accounts.testdomain-12.com',
    toEmail: 'sqlfeatures@gmail.com',
    subject: 'Security alert',  // Real subject
    clickButton: 'keep_all',
    expectedOutcome: 'Subdomain accounts.testdomain-12.com → keep'
  },

  // === Del All / Keep All Operations (T13-T16) - Based on Real Emails ===
  {
    id: 'T13',
    description: 'Del All for promo domain (Google One pattern)',
    // Real email: googleone-updates-noreply@google.com
    fromEmail: 'googleone-updates-noreply@testdomain-13.com',
    toEmail: 'sqlfeatures@gmail.com',
    subject: 'New member benefit: even more ways to edit your photos',  // Real subject
    clickButton: 'del_all',
    expectedOutcome: 'Domain testdomain-13.com → delete'
  },
  {
    id: 'T14',
    description: 'Delete 1D noreply (Google AdSense pattern)',
    // Real email: adsense-noreply@google.com
    fromEmail: 'adsense-noreply@testdomain-14.com',
    toEmail: 'sqlfeatures@gmail.com',
    subject: 'Expanded ad serving protections for minors',  // Real subject
    clickButton: 'delete_1d',
    expectedOutcome: 'Domain testdomain-14.com → delete_1d'
  },
  {
    id: 'T15',
    description: 'Delete 10D (Google Voice pattern)',
    // Real email: voice-noreply@google.com
    fromEmail: 'voice-noreply@testdomain-15.com',
    toEmail: 'sqlfeatures@gmail.com',
    subject: 'Your Google Voice number (650) 691-8947 will expire in 30 days',  // Real subject
    clickButton: 'delete_10d',
    expectedOutcome: 'Domain testdomain-15.com → delete_10d'
  },
  {
    id: 'T16',
    description: 'Keep All for support domain (Google Fi pattern)',
    // Real email: google-fi-support@google.com (no display name in original)
    fromEmail: 'google-fi-support@testdomain-16.com',
    toEmail: 'sqlfeatures@gmail.com',
    subject: '[0-8781000036082] Your Google Fi Support Inquiry: Case ID',  // Real subject
    clickButton: 'keep_all',
    expectedOutcome: 'Domain testdomain-16.com → keep'
  },

  // === Edge Cases (T17-T20) - Based on Real Gmail Quirks ===
  {
    id: 'T17',
    description: 'Subdomain with fi prefix (Assurant pattern)',
    // Real email: device-protection@fi.assurant.com
    fromEmail: 'device-protection@fi.testdomain-17.com',
    toEmail: 'SQLFEATURES@gmail.com',  // Real: uppercase in toEmail
    subject: 'Your Google Fi device is now covered',  // Real subject
    clickButton: 'delete',
    expectedOutcome: 'Domain testdomain-17.com → delete'
  },
  {
    id: 'T18',
    description: 'Unicode in subject (Google pattern)',
    // Real email: no-reply@google.com with emoji in subject
    fromEmail: 'no-reply@testdomain-18.com',
    toEmail: 'sqlfeatures@gmail.com',
    subject: '✅ Prakash, finish setting up your Motorola moto g play - 2024 device with Google',  // Real subject with emoji
    clickButton: 'delete',
    expectedOutcome: 'Domain testdomain-18.com → delete'
  },
  {
    id: 'T19',
    description: 'Mixed case email (Facebook pattern)',
    // Real email: security@facebookmail.com
    fromEmail: 'security@TESTDOMAIN-19.COM',
    toEmail: 'sqlfeatures@gmail.com',
    subject: 'Security alert',  // Real subject pattern
    clickButton: 'delete',
    expectedOutcome: 'Domain testdomain-19.com → delete (lowercase)'
  },
  {
    id: 'T20',
    description: 'Personal email forward (Prakash pattern)',
    // Real email: sqlfeatures@gmail.com
    fromEmail: 'sqlfeatures@testdomain-20.com',
    toEmail: 'prakash.heda@gmail.com',  // Real: different recipient
    subject: 'Fwd: Your Project Fi Order from Nov 24, 2017 Has Shipped',  // Real subject with Fwd:
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
 * Build the API endpoint and body for a test scenario.
 * NO PARSING - pass raw fromEmail to stored procedure, let SQL handle it.
 */
function buildApiRequest(scenario: TestScenario): { endpoint: string; body: Record<string, unknown> } {
  // Determine endpoint based on button clicked
  let endpoint: string;
  let body: Record<string, unknown>;

  switch (scenario.clickButton) {
    case 'keep':
    case 'keep_all':
      // mark-keep endpoint - pass raw fromEmail
      endpoint = '/api/actions/mark-keep';
      body = {
        fromEmail: scenario.fromEmail,
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
        subject_pattern: scenario.selectText
      };
      break;
    case 'delete_1d':
      endpoint = '/api/actions/add-criteria-1d';
      body = {
        fromEmail: scenario.fromEmail,
        subject: scenario.subject,
        subject_pattern: scenario.selectText
      };
      break;
    case 'delete_10d':
      endpoint = '/api/actions/add-criteria-10d';
      body = {
        fromEmail: scenario.fromEmail,
        subject: scenario.subject,
        subject_pattern: scenario.selectText
      };
      break;
    default:
      endpoint = '/api/actions/add-criteria';
      body = {
        fromEmail: scenario.fromEmail,
        subject: scenario.subject,
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
