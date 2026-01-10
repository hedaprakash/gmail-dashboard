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

export default router;
