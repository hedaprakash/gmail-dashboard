import { useState, useRef, useEffect } from 'react';
import {
  useTestScenarios,
  useRunTest,
  useRunAllTests,
  useResetTests,
  useLogs,
  useClearLogs,
  getButtonColor,
  getButtonLabel,
  getStatusColor,
  getStatusBadgeColor,
  getStatusIcon,
  formatSqlResult,
  getLogEntryColor,
  type ButtonType,
  type TestScenario,
  type LogEntry
} from '../hooks/useTesting';

// All button types in order
const ALL_BUTTONS: ButtonType[] = ['keep', 'delete', 'delete_1d', 'delete_10d', 'keep_all', 'del_all'];

export default function Testing() {
  const [isPaused, setIsPaused] = useState(false);
  const [isLogCollapsed, setIsLogCollapsed] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Fetch data
  const { data: scenariosData, isLoading, error, refetch } = useTestScenarios();
  const { data: logsData } = useLogs(0, 500);

  // Mutations
  const runTestMutation = useRunTest();
  const runAllMutation = useRunAllTests();
  const resetMutation = useResetTests();
  const clearLogsMutation = useClearLogs();

  // Auto-scroll logs
  useEffect(() => {
    if (!isPaused && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logsData?.logs, isPaused]);

  // Handle run single test
  const handleRunTest = async (id: string) => {
    try {
      await runTestMutation.mutateAsync(id);
    } catch (err) {
      console.error('Error running test:', err);
    }
  };

  // Handle run all tests
  const handleRunAll = async () => {
    try {
      await runAllMutation.mutateAsync();
    } catch (err) {
      console.error('Error running all tests:', err);
    }
  };

  // Handle reset
  const handleReset = async () => {
    if (!confirm('This will clear all test data and results. Are you sure?')) {
      return;
    }
    try {
      await resetMutation.mutateAsync();
      refetch();
    } catch (err) {
      console.error('Error resetting tests:', err);
    }
  };

  // Handle clear logs
  const handleClearLogs = async () => {
    try {
      await clearLogsMutation.mutateAsync();
    } catch (err) {
      console.error('Error clearing logs:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-gray-600">Loading test scenarios...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="text-red-800 font-medium">Error loading test scenarios</h3>
        <p className="text-red-600 text-sm mt-1">{error.message}</p>
      </div>
    );
  }

  const scenarios = scenariosData?.scenarios || [];
  const summary = scenariosData?.summary || { total: 0, passed: 0, failed: 0, pending: 0 };
  const isRunning = runTestMutation.isPending || runAllMutation.isPending;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Testing Scenarios</h1>
          <p className="text-gray-500 text-sm mt-1">
            Real-world simulation of Review page actions with test emails
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleRunAll}
            disabled={isRunning}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {runAllMutation.isPending ? (
              <>
                <span className="animate-spin">&#8634;</span>
                Running...
              </>
            ) : (
              <>&#9658; Run All</>
            )}
          </button>
          <button
            onClick={handleReset}
            disabled={isRunning || resetMutation.isPending}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            &#8634; Reset All
          </button>
        </div>
      </div>

      {/* Summary Bar */}
      <div className="bg-white rounded-lg border px-4 py-3">
        <div className="flex gap-6 text-sm">
          <span className="text-gray-600">
            Total: <strong>{summary.total}</strong>
          </span>
          <span className="text-green-600">
            Passed: <strong>{summary.passed}</strong>
          </span>
          <span className="text-red-600">
            Failed: <strong>{summary.failed}</strong>
          </span>
          <span className="text-gray-400">
            Pending: <strong>{summary.pending}</strong>
          </span>
        </div>
      </div>

      {/* Progress Bar (shown during batch run) */}
      {runAllMutation.isPending && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
            <span className="text-blue-800">Running all tests sequentially...</span>
          </div>
        </div>
      )}

      {/* Test Cards */}
      <div className="space-y-4 max-h-[50vh] overflow-auto pr-2">
        {scenarios.map(scenario => (
          <TestCard
            key={scenario.id}
            scenario={scenario}
            onRun={handleRunTest}
            isRunning={runTestMutation.isPending && runTestMutation.variables === scenario.id}
            disabled={isRunning}
          />
        ))}
      </div>

      {/* Execution Log Panel */}
      <div className={`bg-gray-900 rounded-lg overflow-hidden ${isLogCollapsed ? 'h-12' : ''}`}>
        {/* Log Header */}
        <div className="flex justify-between items-center px-4 py-2 bg-gray-800">
          <span className="text-gray-300 font-medium">Execution Log</span>
          <div className="flex gap-2">
            <button
              onClick={handleClearLogs}
              className="px-2 py-1 text-xs text-gray-400 hover:text-white"
            >
              Clear
            </button>
            <button
              onClick={() => setIsPaused(!isPaused)}
              className={`px-2 py-1 text-xs ${isPaused ? 'text-yellow-400' : 'text-gray-400 hover:text-white'}`}
            >
              {isPaused ? 'Resume' : 'Pause'}
            </button>
            <button
              onClick={() => setIsLogCollapsed(!isLogCollapsed)}
              className="px-2 py-1 text-xs text-gray-400 hover:text-white"
            >
              {isLogCollapsed ? '&#9650;' : '&#9660;'}
            </button>
          </div>
        </div>

        {/* Log Content */}
        {!isLogCollapsed && (
          <div
            ref={logContainerRef}
            className="h-64 overflow-auto p-4 font-mono text-xs"
          >
            {logsData?.logs?.length === 0 ? (
              <div className="text-gray-500 italic">No log entries yet. Run a test to see activity.</div>
            ) : (
              logsData?.logs?.map((entry, index) => (
                <LogEntryRow key={index} entry={entry} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Test Card Component
// ============================================================================

interface TestCardProps {
  scenario: TestScenario;
  onRun: (id: string) => void;
  isRunning: boolean;
  disabled: boolean;
}

function TestCard({ scenario, onRun, isRunning, disabled }: TestCardProps) {
  const result = scenario.result;
  const status = result?.status || 'pending';

  return (
    <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
      {/* Card Header */}
      <div className="bg-blue-500 text-white px-4 py-2 flex justify-between items-center">
        <span className="font-medium">
          TEST {scenario.id}: {scenario.description}
        </span>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusBadgeColor(status)}`}>
          {getStatusIcon(status)} {status.toUpperCase()}
        </span>
      </div>

      {/* Email Details */}
      <div className="p-4 space-y-2 border-b">
        <div className="flex">
          <span className="text-gray-500 w-16">From:</span>
          <span className="text-blue-600 font-medium">{scenario.fromEmail}</span>
        </div>
        <div className="flex">
          <span className="text-gray-500 w-16">To:</span>
          <span className="text-gray-700">{scenario.toEmail}</span>
        </div>
        <div className="flex">
          <span className="text-gray-500 w-16">Subject:</span>
          <span className="text-gray-900">
            {renderSubjectWithHighlight(scenario.subject, scenario.selectText)}
          </span>
        </div>
        {scenario.selectText && (
          <div className="text-xs text-yellow-600 ml-16">
            &#8593; Select "{scenario.selectText}" before clicking the button
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="px-4 py-3 border-b bg-gray-50">
        <div className="flex gap-2 flex-wrap">
          {ALL_BUTTONS.map(btn => (
            <button
              key={btn}
              className={`px-3 py-1.5 text-sm font-medium rounded transition-all ${getButtonColor(btn, btn === scenario.clickButton)}`}
            >
              {getButtonLabel(btn)}
            </button>
          ))}
        </div>
        {scenario.clickButton && (
          <div className="text-xs text-gray-500 mt-2">
            &#8593; Click the highlighted "{getButtonLabel(scenario.clickButton)}" button
          </div>
        )}
      </div>

      {/* Expected Outcome */}
      <div className="px-4 py-2 bg-gray-100 border-b">
        <span className="text-gray-500 text-sm">Expected: </span>
        <span className="text-gray-800 text-sm font-medium">{scenario.expectedOutcome}</span>
      </div>

      {/* Results Row */}
      <div className="px-4 py-3 flex items-center gap-4">
        <button
          onClick={() => onRun(scenario.id)}
          disabled={disabled || isRunning}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
        >
          {isRunning ? (
            <><span className="animate-spin">&#8634;</span> Running...</>
          ) : (
            <>&#9658; Run</>
          )}
        </button>

        <div className="flex-1 flex gap-6 text-sm">
          <div>
            <span className="text-gray-500">API: </span>
            {result?.apiResult ? (
              <span className={getStatusColor(status)}>
                {result.apiResult.success ? '&#10003;' : '&#10007;'} {result.apiResult.responseTime}ms
              </span>
            ) : (
              <span className="text-gray-400">&#8212;</span>
            )}
          </div>
          <div>
            <span className="text-gray-500">SQL: </span>
            <span className={result?.sqlResult ? 'text-blue-600' : 'text-gray-400'}>
              {formatSqlResult(result?.sqlResult)}
            </span>
          </div>
        </div>

        {result?.error && (
          <div className="text-red-500 text-xs truncate max-w-[200px]" title={result.error}>
            {result.error}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Render subject with highlighted text for pattern selection.
 */
function renderSubjectWithHighlight(subject: string, selectText?: string) {
  if (!selectText) {
    return subject;
  }

  const index = subject.toLowerCase().indexOf(selectText.toLowerCase());
  if (index === -1) {
    return subject;
  }

  return (
    <>
      {subject.slice(0, index)}
      <span className="bg-yellow-200 px-0.5 rounded">{subject.slice(index, index + selectText.length)}</span>
      {subject.slice(index + selectText.length)}
    </>
  );
}

// ============================================================================
// Log Entry Component
// ============================================================================

interface LogEntryRowProps {
  entry: LogEntry;
}

function LogEntryRow({ entry }: LogEntryRowProps) {
  const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const icon = getLogIcon(entry.type);

  return (
    <div className="mb-1">
      <span className="text-gray-500">[{time}]</span>
      {icon && <span className="ml-2">{icon}</span>}
      <span className={`ml-2 ${getLogEntryColor(entry.type)}`}>
        {entry.message}
      </span>
      {entry.details && (
        <pre className="ml-12 text-gray-500 whitespace-pre-wrap text-xs">{entry.details}</pre>
      )}
    </div>
  );
}

function getLogIcon(type: LogEntry['type']): string {
  switch (type) {
    case 'test-start': return '&#9473;&#9473;&#9473;';
    case 'api-request': return '&#8594;';
    case 'api-response': return '&#8592;';
    case 'sql-query': return '&#128269;';
    case 'sql-result': return '&#128202;';
    case 'pass': return '&#10004;';
    case 'fail': return '&#10008;';
    case 'error': return '&#9888;';
    case 'info': return '&#128221;';
    default: return '';
  }
}
