import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ============================================================================
// Types (V2 - Email Format)
// ============================================================================

export type ButtonType = 'keep' | 'delete' | 'delete_1d' | 'delete_10d' | 'keep_all' | 'del_all';
export type TestStatus = 'pending' | 'running' | 'passed' | 'failed';

export interface TestScenario {
  id: string;
  description: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  selectText?: string;
  clickButton: ButtonType;
  expectedOutcome: string;
  result?: TestResult;
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
  status: TestStatus;
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

interface ScenariosResponse {
  success: boolean;
  scenarios: TestScenario[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    pending: number;
  };
  sqlCounts: SqlCounts;
  lastRun: string | null;
}

interface RunTestResponse {
  success: boolean;
  result: TestResult;
}

interface RunAllResponse {
  success: boolean;
  results: TestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    duration: number;
  };
}

interface ResetResponse {
  success: boolean;
  message: string;
  cleared: SqlCounts;
}

interface SqlCountsResponse {
  success: boolean;
  counts: SqlCounts;
}

interface LogsResponse {
  success: boolean;
  logs: LogEntry[];
  total: number;
  offset: number;
  limit: number;
}

// Include credentials for session-based auth
const fetchOptions: RequestInit = {
  credentials: 'include'
};

// ============================================================================
// API Functions
// ============================================================================

async function fetchScenarios(): Promise<ScenariosResponse> {
  const res = await fetch('/api/testing/scenarios', fetchOptions);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to fetch scenarios');
  }
  return res.json();
}

async function runTest(id: string): Promise<RunTestResponse> {
  const res = await fetch(`/api/testing/run/${id}`, {
    ...fetchOptions,
    method: 'POST'
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to run test');
  }
  return res.json();
}

async function runAllTests(): Promise<RunAllResponse> {
  const res = await fetch('/api/testing/run-all', {
    ...fetchOptions,
    method: 'POST'
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to run all tests');
  }
  return res.json();
}

async function resetTests(): Promise<ResetResponse> {
  const res = await fetch('/api/testing/reset', {
    ...fetchOptions,
    method: 'POST'
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to reset tests');
  }
  return res.json();
}

async function fetchSqlCounts(): Promise<SqlCountsResponse> {
  const res = await fetch('/api/testing/sql-counts', fetchOptions);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to fetch SQL counts');
  }
  return res.json();
}

async function fetchLogs(offset = 0, limit = 100, testId?: string): Promise<LogsResponse> {
  const params = new URLSearchParams({
    offset: offset.toString(),
    limit: limit.toString()
  });
  if (testId) {
    params.set('testId', testId);
  }

  const res = await fetch(`/api/testing/logs?${params}`, fetchOptions);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to fetch logs');
  }
  return res.json();
}

async function clearLogs(): Promise<{ success: boolean; message: string }> {
  const res = await fetch('/api/testing/logs', {
    ...fetchOptions,
    method: 'DELETE'
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to clear logs');
  }
  return res.json();
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to fetch all test scenarios with their results.
 */
export function useTestScenarios() {
  return useQuery({
    queryKey: ['testing', 'scenarios'],
    queryFn: fetchScenarios
  });
}

/**
 * Hook to fetch current SQL counts for the test user.
 */
export function useSqlCounts() {
  return useQuery({
    queryKey: ['testing', 'sql-counts'],
    queryFn: fetchSqlCounts
  });
}

/**
 * Hook to fetch execution logs.
 */
export function useLogs(offset = 0, limit = 100, testId?: string) {
  return useQuery({
    queryKey: ['testing', 'logs', offset, limit, testId],
    queryFn: () => fetchLogs(offset, limit, testId),
    refetchInterval: 2000  // Auto-refresh every 2 seconds for live updates
  });
}

/**
 * Hook to run a single test scenario.
 */
export function useRunTest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: runTest,
    onSuccess: () => {
      // Invalidate scenarios to refresh results
      queryClient.invalidateQueries({ queryKey: ['testing', 'scenarios'] });
      queryClient.invalidateQueries({ queryKey: ['testing', 'sql-counts'] });
      queryClient.invalidateQueries({ queryKey: ['testing', 'logs'] });
    }
  });
}

/**
 * Hook to run all test scenarios.
 */
export function useRunAllTests() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: runAllTests,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['testing', 'scenarios'] });
      queryClient.invalidateQueries({ queryKey: ['testing', 'sql-counts'] });
      queryClient.invalidateQueries({ queryKey: ['testing', 'logs'] });
    }
  });
}

/**
 * Hook to reset all test data.
 */
export function useResetTests() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: resetTests,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['testing', 'scenarios'] });
      queryClient.invalidateQueries({ queryKey: ['testing', 'sql-counts'] });
      queryClient.invalidateQueries({ queryKey: ['testing', 'logs'] });
    }
  });
}

/**
 * Hook to clear execution logs.
 */
export function useClearLogs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: clearLogs,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['testing', 'logs'] });
    }
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the color class for a button type.
 */
export function getButtonColor(button: ButtonType, isActive: boolean): string {
  if (!isActive) {
    return 'bg-gray-100 text-gray-600 hover:bg-gray-200';
  }

  switch (button) {
    case 'keep':
    case 'keep_all':
      return 'bg-green-500 text-white ring-2 ring-green-300';
    case 'delete':
    case 'del_all':
      return 'bg-red-500 text-white ring-2 ring-red-300';
    case 'delete_1d':
      return 'bg-orange-500 text-white ring-2 ring-orange-300';
    case 'delete_10d':
      return 'bg-amber-600 text-white ring-2 ring-amber-300';
    default:
      return 'bg-gray-500 text-white';
  }
}

/**
 * Get button label for display.
 */
export function getButtonLabel(button: ButtonType): string {
  switch (button) {
    case 'keep': return 'Keep';
    case 'delete': return 'Delete';
    case 'delete_1d': return 'Del 1D';
    case 'delete_10d': return 'Del 10D';
    case 'keep_all': return 'Keep All';
    case 'del_all': return 'Del All';
    default: return button;
  }
}

/**
 * Get the color class for a test status.
 */
export function getStatusColor(status: TestStatus): string {
  switch (status) {
    case 'passed': return 'text-green-600';
    case 'failed': return 'text-red-600';
    case 'running': return 'text-blue-600';
    case 'pending': return 'text-gray-400';
    default: return 'text-gray-400';
  }
}

/**
 * Get the background color for status badge.
 */
export function getStatusBadgeColor(status: TestStatus): string {
  switch (status) {
    case 'passed': return 'bg-green-100 text-green-800';
    case 'failed': return 'bg-red-100 text-red-800';
    case 'running': return 'bg-blue-100 text-blue-800';
    case 'pending': return 'bg-gray-100 text-gray-500';
    default: return 'bg-gray-100 text-gray-500';
  }
}

/**
 * Get the icon for a test status.
 */
export function getStatusIcon(status: TestStatus): string {
  switch (status) {
    case 'passed': return '✓';
    case 'failed': return '✗';
    case 'running': return '⟳';
    case 'pending': return '—';
    default: return '—';
  }
}

/**
 * Format SQL result as a compact string.
 */
export function formatSqlResult(sqlResult?: SqlResult): string {
  if (!sqlResult) return '—';

  const parts: string[] = [];
  if (sqlResult.criteria !== 0) {
    parts.push(`crit: ${sqlResult.criteria >= 0 ? '+' : ''}${sqlResult.criteria}`);
  }
  if (sqlResult.patterns !== 0) {
    parts.push(`pat: ${sqlResult.patterns >= 0 ? '+' : ''}${sqlResult.patterns}`);
  }
  if (sqlResult.email_patterns !== 0) {
    parts.push(`ep: ${sqlResult.email_patterns >= 0 ? '+' : ''}${sqlResult.email_patterns}`);
  }
  if (sqlResult.audit_log !== 0) {
    parts.push(`aud: ${sqlResult.audit_log >= 0 ? '+' : ''}${sqlResult.audit_log}`);
  }

  return parts.length > 0 ? parts.join(', ') : 'no change';
}

/**
 * Get the color for a log entry type.
 */
export function getLogEntryColor(type: LogEntry['type']): string {
  switch (type) {
    case 'test-start': return 'text-white font-bold';
    case 'api-request': return 'text-cyan-400';
    case 'api-response': return 'text-green-400';
    case 'sql-query': return 'text-yellow-400';
    case 'sql-result': return 'text-blue-400';
    case 'pass': return 'text-green-400 font-bold';
    case 'fail': return 'text-red-400 font-bold';
    case 'error': return 'text-red-400';
    case 'info': return 'text-gray-400';
    default: return 'text-gray-400';
  }
}
