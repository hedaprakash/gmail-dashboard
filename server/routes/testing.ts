/**
 * Testing Routes
 *
 * Provides API endpoints for the Testing Scenarios page.
 * All test operations use a dedicated test user for isolation.
 */

import { Router, Request, Response } from 'express';
import {
  TEST_USER_EMAIL,
  getTestScenarios,
  getTestScenarioById,
  getSqlCounts,
  clearTestData,
  executeTestScenario,
  type TestResult,
  type LogEntry
} from '../services/testing.js';

const router = Router();

// Store test results in memory (per session)
const testResults: Map<string, TestResult> = new Map();
const logEntries: LogEntry[] = [];

/**
 * GET /api/testing/scenarios
 * Get all test scenarios with their current results.
 */
router.get('/scenarios', async (req: Request, res: Response) => {
  try {
    const scenarios = getTestScenarios();

    // Get current SQL counts for context
    const sqlCounts = await getSqlCounts();

    // Get results for each scenario
    const scenariosWithResults = scenarios.map(scenario => ({
      ...scenario,
      result: testResults.get(scenario.id) || { scenarioId: scenario.id, status: 'pending' as const }
    }));

    // Calculate summary
    const results = Array.from(testResults.values());
    const summary = {
      total: scenarios.length,
      passed: results.filter(r => r.status === 'passed').length,
      failed: results.filter(r => r.status === 'failed').length,
      pending: scenarios.length - results.length
    };

    res.json({
      success: true,
      scenarios: scenariosWithResults,
      summary,
      sqlCounts,
      lastRun: logEntries.length > 0 ? logEntries[logEntries.length - 1].timestamp : null
    });
  } catch (error) {
    console.error('Error getting test scenarios:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get test scenarios'
    });
  }
});

/**
 * POST /api/testing/run/:id
 * Execute a single test scenario.
 */
router.post('/run/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const scenario = getTestScenarioById(id);

    if (!scenario) {
      res.status(404).json({
        success: false,
        error: `Test scenario ${id} not found`
      });
      return;
    }

    // Get the base URL from the request
    const protocol = req.protocol;
    const host = req.get('host') || 'localhost:5000';
    const baseUrl = `${protocol}://${host}`;

    // Execute the test with logging
    const result = await executeTestScenario(scenario, baseUrl, (entry) => {
      logEntries.push(entry);
      // Keep only last 1000 log entries
      if (logEntries.length > 1000) {
        logEntries.shift();
      }
    });

    // Store the result
    testResults.set(id, result);

    res.json({
      success: true,
      result
    });
  } catch (error) {
    console.error('Error running test scenario:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to run test'
    });
  }
});

/**
 * POST /api/testing/run-all
 * Execute all test scenarios sequentially.
 * Returns results for all tests.
 */
router.post('/run-all', async (req: Request, res: Response) => {
  try {
    const scenarios = getTestScenarios();
    const results: TestResult[] = [];

    // Get the base URL from the request
    const protocol = req.protocol;
    const host = req.get('host') || 'localhost:5000';
    const baseUrl = `${protocol}://${host}`;

    const startTime = Date.now();

    // Add start log
    logEntries.push({
      timestamp: new Date().toISOString(),
      type: 'info',
      message: `Starting batch test run: ${scenarios.length} scenarios`
    });

    // Execute each scenario sequentially
    for (const scenario of scenarios) {
      const result = await executeTestScenario(scenario, baseUrl, (entry) => {
        logEntries.push(entry);
        if (logEntries.length > 1000) {
          logEntries.shift();
        }
      });

      testResults.set(scenario.id, result);
      results.push(result);
    }

    const duration = Date.now() - startTime;

    // Add completion log
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;

    logEntries.push({
      timestamp: new Date().toISOString(),
      type: 'info',
      message: `Batch test run complete: ${passed} passed, ${failed} failed (${duration}ms)`
    });

    res.json({
      success: true,
      results,
      summary: {
        total: results.length,
        passed,
        failed,
        duration
      }
    });
  } catch (error) {
    console.error('Error running all tests:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to run tests'
    });
  }
});

/**
 * POST /api/testing/reset
 * Clear all test data and reset results.
 */
router.post('/reset', async (req: Request, res: Response) => {
  try {
    // Clear test data from SQL Server
    const clearResult = await clearTestData();

    if (!clearResult.success) {
      res.status(500).json({
        success: false,
        error: clearResult.message
      });
      return;
    }

    // Clear in-memory results
    testResults.clear();

    // Add log entry
    logEntries.push({
      timestamp: new Date().toISOString(),
      type: 'info',
      message: `Test data reset: cleared ${clearResult.cleared.criteria} criteria, ${clearResult.cleared.patterns} patterns, ${clearResult.cleared.audit_log} audit entries`
    });

    res.json({
      success: true,
      message: 'Test data cleared successfully',
      cleared: clearResult.cleared
    });
  } catch (error) {
    console.error('Error resetting test data:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reset test data'
    });
  }
});

/**
 * GET /api/testing/sql-counts
 * Get current SQL row counts for the test user.
 */
router.get('/sql-counts', async (req: Request, res: Response) => {
  try {
    const counts = await getSqlCounts();

    res.json({
      success: true,
      counts
    });
  } catch (error) {
    console.error('Error getting SQL counts:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get SQL counts'
    });
  }
});

/**
 * GET /api/testing/logs
 * Get execution log entries.
 * Supports pagination with offset and limit.
 */
router.get('/logs', (req: Request, res: Response) => {
  try {
    const offset = parseInt(req.query.offset as string) || 0;
    const limit = parseInt(req.query.limit as string) || 100;
    const testId = req.query.testId as string | undefined;

    let entries = logEntries;

    // Filter by test ID if specified
    if (testId) {
      entries = entries.filter(e => e.testId === testId);
    }

    // Apply pagination
    const paginatedEntries = entries.slice(offset, offset + limit);

    res.json({
      success: true,
      logs: paginatedEntries,
      total: entries.length,
      offset,
      limit
    });
  } catch (error) {
    console.error('Error getting logs:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get logs'
    });
  }
});

/**
 * DELETE /api/testing/logs
 * Clear all log entries.
 */
router.delete('/logs', (req: Request, res: Response) => {
  try {
    const count = logEntries.length;
    logEntries.length = 0;

    res.json({
      success: true,
      message: `Cleared ${count} log entries`
    });
  } catch (error) {
    console.error('Error clearing logs:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to clear logs'
    });
  }
});

/**
 * GET /api/testing/report
 * Generate HTML test report.
 */
router.get('/report', async (req: Request, res: Response) => {
  try {
    const scenarios = getTestScenarios();
    const sqlCounts = await getSqlCounts();
    const timestamp = new Date().toISOString();

    // Calculate summary
    const results = Array.from(testResults.values());
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;

    // Calculate total duration from logs
    const startLog = logEntries.find(l => l.message.includes('Starting batch test run'));
    const endLog = logEntries.find(l => l.message.includes('Batch test run complete'));
    let duration = 0;
    if (endLog) {
      const match = endLog.message.match(/\((\d+)ms\)/);
      if (match) duration = parseInt(match[1]);
    }

    // Generate HTML
    const html = generateHtmlReport({
      scenarios,
      testResults,
      logEntries,
      sqlCounts,
      summary: { total: scenarios.length, passed, failed, duration },
      timestamp
    });

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate report'
    });
  }
});

/**
 * GET /api/testing/export
 * Export test results as JSON.
 */
router.get('/export', async (req: Request, res: Response) => {
  try {
    const scenarios = getTestScenarios();
    const sqlCounts = await getSqlCounts();

    const exportData = {
      exportedAt: new Date().toISOString(),
      testUser: TEST_USER_EMAIL,
      sqlCounts,
      scenarios: scenarios.map(scenario => ({
        ...scenario,
        result: testResults.get(scenario.id) || { scenarioId: scenario.id, status: 'pending' }
      })),
      summary: {
        total: scenarios.length,
        passed: Array.from(testResults.values()).filter(r => r.status === 'passed').length,
        failed: Array.from(testResults.values()).filter(r => r.status === 'failed').length,
        pending: scenarios.length - testResults.size
      },
      logs: logEntries
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=test-results-${new Date().toISOString().split('T')[0]}.json`);
    res.json(exportData);
  } catch (error) {
    console.error('Error exporting results:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to export results'
    });
  }
});

// ============================================================================
// HTML Report Generator
// ============================================================================

interface ReportData {
  scenarios: ReturnType<typeof getTestScenarios>;
  testResults: Map<string, TestResult>;
  logEntries: LogEntry[];
  sqlCounts: { criteria: number; patterns: number; email_patterns: number; audit_log: number };
  summary: { total: number; passed: number; failed: number; duration: number };
  timestamp: string;
}

function generateHtmlReport(data: ReportData): string {
  const { scenarios, testResults, sqlCounts, summary, timestamp } = data;

  // Calculate total SQL changes
  let totalCriteria = 0, totalPatterns = 0, totalAudit = 0;
  testResults.forEach(r => {
    if (r.sqlResult) {
      totalCriteria += r.sqlResult.criteria;
      totalPatterns += r.sqlResult.patterns;
      totalAudit += r.sqlResult.audit_log;
    }
  });

  const rows = scenarios.map(scenario => {
    const result = testResults.get(scenario.id);
    const apiResult = result?.apiResult;
    const sqlResult = result?.sqlResult;
    const status = result?.status || 'pending';

    // Determine level
    const isSubdomain = scenario.fromEmail.includes('@mail.') ||
                        scenario.fromEmail.includes('@news.') ||
                        scenario.fromEmail.includes('@promo.') ||
                        scenario.fromEmail.includes('@alerts.');
    const level = isSubdomain ? 'subdomain' : 'domain';

    // Extract action from response
    let action = 'unknown';
    if (apiResult?.body && typeof apiResult.body === 'object') {
      const body = apiResult.body as Record<string, unknown>;
      if (body.rules && typeof body.rules === 'object') {
        const rules = body.rules as Record<string, unknown>;
        if (rules.default) action = rules.default as string;
        else if (rules.delete) action = 'delete';
        else if (rules.delete_1d) action = 'delete_1d';
        else if (rules.delete_10d) action = 'delete_10d';
        else if (rules.keep) action = 'keep';
      }
    }

    // Format SQL changes
    const sqlChanges: string[] = [];
    if (sqlResult) {
      if (sqlResult.criteria !== 0) sqlChanges.push(`criteria +${sqlResult.criteria}`);
      if (sqlResult.patterns !== 0) sqlChanges.push(`patterns +${sqlResult.patterns}`);
      if (sqlResult.audit_log !== 0) sqlChanges.push(`audit +${sqlResult.audit_log}`);
    }

    // Get endpoint
    let endpoint = 'add-criteria';
    if (scenario.clickButton === 'keep' || scenario.clickButton === 'keep_all') {
      endpoint = 'mark-keep';
    } else if (scenario.clickButton === 'delete_1d') {
      endpoint = 'add-criteria-1d';
    } else if (scenario.clickButton === 'delete_10d') {
      endpoint = 'add-criteria-10d';
    }

    // Get domain from response
    let domain = '-';
    if (apiResult?.body && typeof apiResult.body === 'object') {
      const body = apiResult.body as Record<string, unknown>;
      if (body.domain) domain = body.domain as string;
    }

    // Get response message
    let responseMsg = apiResult?.message || '-';
    // Shorten the message
    responseMsg = responseMsg
      .replace('Created domain entry: ', 'Created ')
      .replace('Found existing domain entry: ', 'Found existing ')
      .replace('; Set default action: delete_10d', '')
      .replace('; Set default action: delete_1d', '')
      .replace('; Set default action: delete', '')
      .replace('; Set default action', '');

    const actionClass = `action-${action.replace('_', '_')}`;
    const levelClass = `level-${level}`;
    const statusIcon = status === 'passed' ? '&#10004;' : status === 'failed' ? '&#10008;' : '&#8212;';
    const statusClass = status === 'passed' ? 'pass' : status === 'failed' ? 'fail' : '';

    return `
        <tr>
          <td class="test-id">${scenario.id}</td>
          <td class="endpoint">${endpoint}</td>
          <td class="email">${endpoint === 'mark-keep' ? '-' : scenario.fromEmail}</td>
          <td class="subject">${endpoint === 'mark-keep' ? '-' : scenario.subject}</td>
          <td class="level"><span class="${levelClass}">${level}</span></td>
          <td class="pattern">${scenario.selectText || '-'}</td>
          <td class="response-msg">${responseMsg}</td>
          <td class="domain">${domain}</td>
          <td><span class="action ${actionClass}">${action}</span></td>
          <td class="sql">${sqlChanges.join('<br>') || '-'}</td>
          <td class="status"><span class="${statusClass}">${statusIcon}</span><br><span class="time">${apiResult?.responseTime || 0}ms</span></td>
        </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Execution Report - Gmail Dashboard</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      background: #f5f5f5;
      font-size: 12px;
    }
    .container { max-width: 1800px; margin: 0 auto; }
    h1 { color: #333; margin-bottom: 5px; }
    .subtitle { color: #666; margin-bottom: 20px; }
    .summary {
      display: flex;
      gap: 20px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .summary-card {
      background: white;
      padding: 15px 25px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .summary-card.passed { border-left: 4px solid #4CAF50; }
    .summary-card.failed { border-left: 4px solid #f44336; }
    .summary-card.total { border-left: 4px solid #2196F3; }
    .summary-card.time { border-left: 4px solid #FF9800; }
    .summary-card .label { color: #666; font-size: 12px; text-transform: uppercase; }
    .summary-card .value { font-size: 28px; font-weight: bold; color: #333; }
    .summary-card .value.green { color: #4CAF50; }
    .summary-card .value.red { color: #f44336; }

    .table-wrapper { overflow-x: auto; }
    table {
      border-collapse: collapse;
      width: 100%;
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      font-size: 11px;
    }
    th {
      background: #2196F3;
      color: white;
      padding: 10px 8px;
      text-align: left;
      font-weight: 600;
      white-space: nowrap;
    }
    th.request { background: #1976D2; }
    th.response { background: #7B1FA2; }
    td {
      border-bottom: 1px solid #eee;
      padding: 8px;
      vertical-align: top;
    }
    tr:hover { background-color: #f8f9fa; }
    tr:last-child td { border-bottom: none; }

    .test-id { font-weight: bold; color: #2196F3; }
    .endpoint { color: #7B1FA2; font-family: 'Consolas', monospace; font-size: 11px; white-space: nowrap; }
    .email { color: #0D47A1; font-family: 'Consolas', monospace; word-break: break-all; max-width: 200px; }
    .subject { color: #333; max-width: 180px; }
    .level { text-align: center; }
    .level-domain { background: #E3F2FD; color: #1565C0; padding: 2px 6px; border-radius: 3px; font-size: 10px; }
    .level-subdomain { background: #F3E5F5; color: #7B1FA2; padding: 2px 6px; border-radius: 3px; font-size: 10px; }
    .pattern { color: #E65100; font-style: italic; }
    .response-msg { color: #333; max-width: 250px; }
    .domain { color: #1565C0; font-weight: 500; font-family: 'Consolas', monospace; font-size: 10px; }
    .action { font-weight: bold; padding: 2px 6px; border-radius: 3px; font-size: 10px; }
    .action-delete { background: #FFEBEE; color: #C62828; }
    .action-delete_1d { background: #FFF3E0; color: #E65100; }
    .action-delete_10d { background: #FFF8E1; color: #F57F17; }
    .action-keep { background: #E8F5E9; color: #2E7D32; }
    .sql { color: #E65100; font-family: 'Consolas', monospace; white-space: nowrap; font-size: 10px; }
    .status { text-align: center; white-space: nowrap; }
    .pass { color: #4CAF50; font-weight: bold; font-size: 16px; }
    .fail { color: #f44336; font-weight: bold; font-size: 16px; }
    .time { color: #666; font-size: 10px; }

    .footer {
      margin-top: 20px;
      padding: 15px;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .footer-title { font-weight: bold; margin-bottom: 10px; }
    .footer-stats { display: flex; gap: 30px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Test Execution Report</h1>
    <p class="subtitle">Gmail Dashboard API Testing - Generated: ${timestamp}</p>

    <div class="summary">
      <div class="summary-card total">
        <div class="label">Total Tests</div>
        <div class="value">${summary.total}</div>
      </div>
      <div class="summary-card passed">
        <div class="label">Passed</div>
        <div class="value green">${summary.passed}</div>
      </div>
      <div class="summary-card failed">
        <div class="label">Failed</div>
        <div class="value ${summary.failed > 0 ? 'red' : ''}">${summary.failed}</div>
      </div>
      <div class="summary-card time">
        <div class="label">Duration</div>
        <div class="value">${summary.duration}ms</div>
      </div>
    </div>

    <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Endpoint</th>
          <th class="request">fromEmail</th>
          <th class="request">subject</th>
          <th class="request">level</th>
          <th class="request">subject_pattern</th>
          <th class="response">Response Message</th>
          <th class="response">Domain</th>
          <th class="response">Action</th>
          <th>SQL Changes</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    </div>

    <div class="footer">
      <div class="footer-title">Total Database Changes (test user: test-scenarios@test.local)</div>
      <div class="footer-stats">
        <div><strong>criteria:</strong> +${totalCriteria} rows (total: ${sqlCounts.criteria})</div>
        <div><strong>patterns:</strong> +${totalPatterns} rows (total: ${sqlCounts.patterns})</div>
        <div><strong>audit_log:</strong> +${totalAudit} rows (total: ${sqlCounts.audit_log})</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export default router;
