import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

type ActionType = 'delete' | 'delete_1d' | 'delete_10d';

interface ActionSummary {
  action: string;
  count: number;
  oldestDate: string | null;
  newestDate: string | null;
}

interface SummaryResponse {
  success: boolean;
  total: number;
  byAction: ActionSummary[];
}

interface PreviewResult {
  success: boolean;
  actionType: string;
  minAgeDays: number;
  matchCount: number;
  skippedCount: number;
  matches: Array<{
    id: string;
    from: string;
    subject: string;
    date: string;
    matchedRule: string | null;
  }>;
}

interface ExecuteResult {
  success: boolean;
  dryRun: boolean;
  actionType: string;
  summary: {
    total: number;
    deleted: number;
    skipped: number;
    errors: number;
  };
  progress: {
    logs: string[];
  };
}

async function fetchSummary(): Promise<SummaryResponse> {
  const res = await fetch('/api/execute/summary');
  if (!res.ok) throw new Error('Failed to fetch summary');
  return res.json();
}

async function previewDelete(actionType: ActionType, minAgeDays: number): Promise<PreviewResult> {
  const res = await fetch('/api/execute/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionType, minAgeDays })
  });
  if (!res.ok) throw new Error('Preview failed');
  return res.json();
}

async function executeDelete(actionType: ActionType, dryRun: boolean, minAgeDays: number): Promise<ExecuteResult> {
  const res = await fetch('/api/execute/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionType, dryRun, minAgeDays })
  });
  if (!res.ok) throw new Error('Execution failed');
  return res.json();
}

async function reEvaluate(): Promise<{ success: boolean; message: string; summary: Record<string, number> }> {
  const res = await fetch('/api/execute/evaluate', {
    method: 'POST'
  });
  if (!res.ok) throw new Error('Re-evaluation failed');
  return res.json();
}

const actionColors: Record<string, { bg: string; text: string; border: string; label: string }> = {
  delete: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300', label: 'Delete Now' },
  delete_1d: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300', label: 'Delete 1-Day' },
  delete_10d: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300', label: 'Delete 10-Day' },
  keep: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300', label: 'Keep' },
  undecided: { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-300', label: 'Undecided' }
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString();
}

export default function Execute() {
  const queryClient = useQueryClient();
  const [actionType, setActionType] = useState<ActionType>('delete');
  const [dryRun, setDryRun] = useState(true);
  const [minAgeDays, setMinAgeDays] = useState(0);

  // Fetch summary on load
  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useQuery({
    queryKey: ['execute-summary'],
    queryFn: fetchSummary
  });

  const previewMutation = useMutation({
    mutationFn: () => previewDelete(actionType, minAgeDays)
  });

  const executeMutation = useMutation({
    mutationFn: () => executeDelete(actionType, dryRun, minAgeDays),
    onSuccess: () => {
      // Refresh summary after execution
      refetchSummary();
    }
  });

  const evaluateMutation = useMutation({
    mutationFn: reEvaluate,
    onSuccess: () => {
      refetchSummary();
      queryClient.invalidateQueries({ queryKey: ['emails'] });
    }
  });

  // Get count for selected action type
  const selectedCount = summary?.byAction.find(a => a.action === actionType)?.count || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Execute Email Deletion</h1>
        <button
          onClick={() => evaluateMutation.mutate()}
          disabled={evaluateMutation.isPending}
          className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 text-sm"
        >
          {evaluateMutation.isPending ? 'Re-evaluating...' : 'Re-evaluate Emails'}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-700 mb-4">Pending Emails Summary</h2>
        {summaryLoading ? (
          <div className="text-gray-500">Loading summary...</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="text-center p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="text-3xl font-bold text-blue-600">{summary?.total || 0}</div>
              <div className="text-sm text-blue-700">Total Pending</div>
            </div>
            {summary?.byAction.map(item => {
              const colors = actionColors[item.action] || actionColors.undecided;
              return (
                <div
                  key={item.action}
                  className={`text-center p-4 rounded-lg border ${colors.bg} ${colors.border} cursor-pointer transition-transform hover:scale-105 ${
                    actionType === item.action && item.action !== 'keep' && item.action !== 'undecided'
                      ? 'ring-2 ring-offset-2 ring-blue-500'
                      : ''
                  }`}
                  onClick={() => {
                    if (item.action === 'delete' || item.action === 'delete_1d' || item.action === 'delete_10d') {
                      setActionType(item.action);
                    }
                  }}
                >
                  <div className={`text-3xl font-bold ${colors.text}`}>{item.count}</div>
                  <div className={`text-sm ${colors.text}`}>{colors.label}</div>
                  {item.oldestDate && (
                    <div className="text-xs text-gray-500 mt-1">
                      {formatDate(item.oldestDate)} - {formatDate(item.newestDate)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Options */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
        <h2 className="font-semibold text-gray-700">Deletion Options</h2>

        {/* Action Type Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Action Type to Execute</label>
          <div className="flex flex-wrap gap-3">
            {(['delete', 'delete_1d', 'delete_10d'] as const).map(type => {
              const colors = actionColors[type];
              const count = summary?.byAction.find(a => a.action === type)?.count || 0;
              return (
                <button
                  key={type}
                  onClick={() => setActionType(type)}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    actionType === type
                      ? `${colors.bg} ${colors.text} ${colors.border} border-2`
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {colors.label} ({count})
                </button>
              );
            })}
          </div>
          <p className="text-sm text-gray-500 mt-2">
            {actionType === 'delete' && 'Emails marked for immediate deletion'}
            {actionType === 'delete_1d' && 'Emails to delete after 1 day (protects OTPs)'}
            {actionType === 'delete_10d' && 'Emails to delete after 10 days (for archives)'}
          </p>
        </div>

        {/* Min Age */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Minimum Age (days)
          </label>
          <div className="flex items-center gap-4">
            <input
              type="number"
              min="0"
              value={minAgeDays}
              onChange={e => setMinAgeDays(parseInt(e.target.value) || 0)}
              className="w-24 px-3 py-2 border border-gray-300 rounded-lg"
            />
            {actionType === 'delete_1d' && minAgeDays < 1 && (
              <span className="text-orange-600 text-sm">
                Recommended: Set to 1 for delete_1d
              </span>
            )}
            {actionType === 'delete_10d' && minAgeDays < 10 && (
              <span className="text-amber-600 text-sm">
                Recommended: Set to 10 for delete_10d
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Only process emails older than this many days
          </p>
        </div>

        {/* Dry Run */}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={e => setDryRun(e.target.checked)}
            className="w-4 h-4 text-blue-600 rounded"
          />
          <span className="text-sm text-gray-700">
            Dry Run (preview only, no actual deletion)
          </span>
        </label>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-4">
        <button
          onClick={() => previewMutation.mutate()}
          disabled={previewMutation.isPending || selectedCount === 0}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
        >
          {previewMutation.isPending ? 'Loading...' : `Preview ${actionColors[actionType].label}`}
        </button>
        <button
          onClick={() => {
            if (!dryRun && !confirm(`This will PERMANENTLY delete ${selectedCount} emails. Continue?`)) {
              return;
            }
            executeMutation.mutate();
          }}
          disabled={executeMutation.isPending || selectedCount === 0}
          className={`px-4 py-2 rounded-lg text-white disabled:opacity-50 ${
            dryRun ? 'bg-orange-500 hover:bg-orange-600' : 'bg-red-500 hover:bg-red-600'
          }`}
        >
          {executeMutation.isPending
            ? 'Executing...'
            : dryRun
            ? `Execute Dry Run (${selectedCount})`
            : `Execute Delete (${selectedCount})`}
        </button>
      </div>

      {/* Preview Results */}
      {previewMutation.data && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-700 mb-4">
            Preview Results for {actionColors[previewMutation.data.actionType as ActionType]?.label || previewMutation.data.actionType}
          </h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="text-center p-3 bg-red-50 rounded-lg">
              <div className="text-xl font-bold text-red-600">{previewMutation.data.matchCount}</div>
              <div className="text-sm text-red-700">Will be deleted</div>
            </div>
            <div className="text-center p-3 bg-yellow-50 rounded-lg">
              <div className="text-xl font-bold text-yellow-600">{previewMutation.data.skippedCount}</div>
              <div className="text-sm text-yellow-700">Skipped (too recent)</div>
            </div>
          </div>
          {previewMutation.data.matches.length > 0 && (
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">From</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Subject</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Matched Rule</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {previewMutation.data.matches.map((m, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-2 truncate max-w-[150px]" title={m.from}>{m.from}</td>
                      <td className="px-3 py-2 truncate max-w-[250px]" title={m.subject}>{m.subject}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{m.matchedRule || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {previewMutation.data.matchCount > 100 && (
                <p className="text-center text-gray-500 py-2 bg-gray-50">
                  ... and {previewMutation.data.matchCount - 100} more
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Execution Results */}
      {executeMutation.data && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-700 mb-4">
            Execution Results {executeMutation.data.dryRun && '(Dry Run)'}
            <span className="ml-2 text-sm font-normal text-gray-500">
              - {actionColors[executeMutation.data.actionType as ActionType]?.label || executeMutation.data.actionType}
            </span>
          </h3>
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-xl font-bold text-gray-600">{executeMutation.data.summary.total}</div>
              <div className="text-sm text-gray-700">Total</div>
            </div>
            <div className="text-center p-3 bg-red-50 rounded-lg">
              <div className="text-xl font-bold text-red-600">{executeMutation.data.summary.deleted}</div>
              <div className="text-sm text-red-700">Deleted</div>
            </div>
            <div className="text-center p-3 bg-yellow-50 rounded-lg">
              <div className="text-xl font-bold text-yellow-600">{executeMutation.data.summary.skipped}</div>
              <div className="text-sm text-yellow-700">Skipped</div>
            </div>
            <div className="text-center p-3 bg-orange-50 rounded-lg">
              <div className="text-xl font-bold text-orange-600">{executeMutation.data.summary.errors}</div>
              <div className="text-sm text-orange-700">Errors</div>
            </div>
          </div>

          {/* Logs */}
          <div className="bg-gray-900 text-gray-100 rounded-lg p-4 max-h-64 overflow-y-auto font-mono text-xs">
            {executeMutation.data.progress.logs.map((log, i) => (
              <div
                key={i}
                className={`py-0.5 ${
                  log.includes('[DELETED]') ? 'text-red-400' :
                  log.includes('[DRY-RUN]') ? 'text-yellow-400' :
                  log.includes('[ERROR]') ? 'text-orange-400' :
                  log.includes('[SKIP]') ? 'text-gray-400' :
                  'text-gray-300'
                }`}
              >
                {log}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Help Text */}
      <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-4">
        <h4 className="font-medium text-gray-700 mb-2">How it works:</h4>
        <ol className="list-decimal list-inside space-y-1">
          <li>Emails are fetched from Gmail and stored in the SQL Server <code className="bg-gray-200 px-1 rounded">pending_emails</code> table</li>
          <li>The stored procedure evaluates each email against criteria rules and assigns an action</li>
          <li>Select an action type above to see how many emails match</li>
          <li>Preview to see which specific emails will be affected</li>
          <li>Execute with Dry Run first to verify, then uncheck to actually delete</li>
          <li>Click "Re-evaluate Emails" after changing criteria to update actions</li>
        </ol>
      </div>
    </div>
  );
}
