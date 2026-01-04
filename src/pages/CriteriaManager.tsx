import { useState, useMemo, useRef } from 'react';
import {
  useCriteria,
  useDeleteRule,
  useDeleteDomain,
  useAddRule,
  useSetDefaultAction,
  useAddExcludeSubjects,
  useRemoveExcludeSubject,
  useAddDomain,
  useAddSubdomainRule,
  useRemoveSubdomainRule,
  type Action,
  type DomainRules,
  type UnifiedCriteria
} from '../hooks/useCriteria';

type FilterType = 'all' | 'delete' | 'delete_1d' | 'delete_10d' | 'keep';

const actionColors: Record<string, { bg: string; text: string; border: string; label: string }> = {
  delete: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300', label: 'Delete' },
  delete_1d: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300', label: 'Delete 1-Day' },
  delete_10d: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300', label: 'Delete 10-Day' },
  keep: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300', label: 'Keep' },
};

// Count rules for a domain
function countRules(rules: DomainRules): number {
  let count = 0;
  if (rules.default) count++;
  count += rules.excludeSubjects?.length || 0;
  count += rules.keep?.length || 0;
  count += rules.delete?.length || 0;
  count += rules.delete_1d?.length || 0;
  count += rules.delete_10d?.length || 0;
  if (rules.subdomains) {
    for (const subRules of Object.values(rules.subdomains)) {
      count += countRules(subRules);
    }
  }
  return count;
}

// Domain Card Component
function DomainCard({
  domain,
  rules,
  isExpanded,
  onToggle,
}: {
  domain: string;
  rules: DomainRules;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const [newPatternAction, setNewPatternAction] = useState<Action>('delete');
  const [newPatternText, setNewPatternText] = useState('');
  const [newExcludeTerm, setNewExcludeTerm] = useState('');
  const [newSubdomain, setNewSubdomain] = useState('');
  const [newSubdomainAction, setNewSubdomainAction] = useState<Action>('keep');

  const deleteRuleMutation = useDeleteRule();
  const deleteDomainMutation = useDeleteDomain();
  const addRuleMutation = useAddRule();
  const setDefaultMutation = useSetDefaultAction();
  const addExcludeMutation = useAddExcludeSubjects();
  const removeExcludeMutation = useRemoveExcludeSubject();
  const addSubdomainMutation = useAddSubdomainRule();
  const removeSubdomainMutation = useRemoveSubdomainRule();

  const ruleCount = countRules(rules);
  const hasSubdomains = rules.subdomains && Object.keys(rules.subdomains).length > 0;

  const handleSetDefault = (action: Action | null) => {
    setDefaultMutation.mutate({ domain, action });
  };

  const handleAddPattern = () => {
    if (!newPatternText.trim()) return;
    addRuleMutation.mutate({
      domain,
      action: newPatternAction,
      subjectPattern: newPatternText.trim()
    });
    setNewPatternText('');
  };

  const handleRemovePattern = (action: Action, pattern: string) => {
    deleteRuleMutation.mutate({ domain, action, subjectPattern: pattern });
  };

  const handleAddExclude = () => {
    if (!newExcludeTerm.trim()) return;
    addExcludeMutation.mutate({ domain, terms: [newExcludeTerm.trim()] });
    setNewExcludeTerm('');
  };

  const handleRemoveExclude = (term: string) => {
    removeExcludeMutation.mutate({ domain, term });
  };

  const handleAddSubdomain = () => {
    if (!newSubdomain.trim()) return;
    addSubdomainMutation.mutate({
      domain,
      subdomain: newSubdomain.trim(),
      action: newSubdomainAction
    });
    setNewSubdomain('');
  };

  const handleRemoveSubdomain = (subdomain: string) => {
    removeSubdomainMutation.mutate({ domain, subdomain });
  };

  const handleDeleteDomain = () => {
    if (confirm(`Delete ALL rules for ${domain}? This cannot be undone.`)) {
      deleteDomainMutation.mutate(domain);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* Domain Header */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          <span className="text-gray-400 w-4">{isExpanded ? '▼' : '▶'}</span>
          <span className="font-medium text-gray-900">{domain}</span>
          {rules.default && (
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionColors[rules.default].bg} ${actionColors[rules.default].text}`}>
              {actionColors[rules.default].label}
            </span>
          )}
          {hasSubdomains && (
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
              Subdomains
            </span>
          )}
          <span className="text-sm text-gray-500">
            ({ruleCount} rule{ruleCount !== 1 ? 's' : ''})
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDeleteDomain();
          }}
          className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded border border-red-200"
        >
          Delete Domain
        </button>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="p-4 space-y-6 border-t border-gray-200">
          {/* Default Action */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-700">Default Action</h4>
            <p className="text-xs text-gray-500">Applied to all emails from this domain when no pattern matches</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleSetDefault(null)}
                className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
                  !rules.default
                    ? 'bg-gray-200 border-gray-400 text-gray-800'
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                None (Undecided)
              </button>
              {(['delete', 'delete_1d', 'delete_10d', 'keep'] as const).map(action => (
                <button
                  key={action}
                  onClick={() => handleSetDefault(action)}
                  className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
                    rules.default === action
                      ? `${actionColors[action].bg} ${actionColors[action].border} ${actionColors[action].text}`
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {actionColors[action].label}
                </button>
              ))}
            </div>
          </div>

          {/* Exclude Subjects */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-700">Exclude from Default</h4>
            <p className="text-xs text-gray-500">Subjects containing these terms will be undecided (skip default action)</p>
            <div className="flex flex-wrap gap-2">
              {rules.excludeSubjects?.map(term => (
                <span
                  key={term}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-50 text-yellow-800 rounded text-sm border border-yellow-200"
                >
                  {term}
                  <button
                    onClick={() => handleRemoveExclude(term)}
                    className="text-yellow-600 hover:text-yellow-800 ml-1"
                  >
                    ×
                  </button>
                </span>
              ))}
              {(!rules.excludeSubjects || rules.excludeSubjects.length === 0) && (
                <span className="text-sm text-gray-400 italic">No exclusions</span>
              )}
            </div>
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={newExcludeTerm}
                onChange={e => setNewExcludeTerm(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddExclude()}
                placeholder="Add exclusion term..."
                className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={handleAddExclude}
                disabled={!newExcludeTerm.trim()}
                className="px-3 py-1.5 text-sm bg-yellow-500 text-white rounded hover:bg-yellow-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          </div>

          {/* Subject Patterns */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-700">Subject Patterns</h4>
            <p className="text-xs text-gray-500">Patterns take priority over default action (Keep &gt; Delete &gt; Delete 1-Day)</p>
            <div className="border border-gray-200 rounded overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-28">Action</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Pattern</th>
                    <th className="px-3 py-2 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(['keep', 'delete', 'delete_1d', 'delete_10d'] as const).map(action =>
                    rules[action]?.map(pattern => (
                      <tr key={`${action}-${pattern}`} className="hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionColors[action].bg} ${actionColors[action].text}`}>
                            {actionColors[action].label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-700">{pattern}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => handleRemovePattern(action, pattern)}
                            className="text-red-500 hover:text-red-700"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                  {!rules.keep?.length && !rules.delete?.length && !rules.delete_1d?.length && !rules.delete_10d?.length && (
                    <tr>
                      <td colSpan={3} className="px-3 py-4 text-center text-gray-400 italic">
                        No patterns defined
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* Add Pattern Form */}
            <div className="flex gap-2 mt-2">
              <select
                value={newPatternAction}
                onChange={e => setNewPatternAction(e.target.value as Action)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              >
                <option value="keep">Keep</option>
                <option value="delete">Delete</option>
                <option value="delete_1d">Delete 1-Day</option>
                <option value="delete_10d">Delete 10-Day</option>
              </select>
              <input
                type="text"
                value={newPatternText}
                onChange={e => setNewPatternText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddPattern()}
                placeholder="Subject pattern to match..."
                className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={handleAddPattern}
                disabled={!newPatternText.trim()}
                className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Pattern
              </button>
            </div>
          </div>

          {/* Subdomains */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-700">Subdomain Overrides</h4>
            <p className="text-xs text-gray-500">Subdomain rules completely override parent domain rules</p>
            <div className="border border-gray-200 rounded overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Subdomain</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-32">Default Action</th>
                    <th className="px-3 py-2 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rules.subdomains && Object.entries(rules.subdomains).map(([subdomain, subRules]) => (
                    <tr key={subdomain} className="hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <span className="text-purple-700 bg-purple-50 px-2 py-0.5 rounded text-xs">
                          {subdomain}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {subRules.default && (
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionColors[subRules.default].bg} ${actionColors[subRules.default].text}`}>
                            {actionColors[subRules.default].label}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => handleRemoveSubdomain(subdomain)}
                          className="text-red-500 hover:text-red-700"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(!rules.subdomains || Object.keys(rules.subdomains).length === 0) && (
                    <tr>
                      <td colSpan={3} className="px-3 py-4 text-center text-gray-400 italic">
                        No subdomain overrides
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* Add Subdomain Form */}
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={newSubdomain}
                onChange={e => setNewSubdomain(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddSubdomain()}
                placeholder={`e.g., alerts.${domain}`}
                className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <select
                value={newSubdomainAction}
                onChange={e => setNewSubdomainAction(e.target.value as Action)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              >
                <option value="keep">Keep</option>
                <option value="delete">Delete</option>
                <option value="delete_1d">Delete 1-Day</option>
                <option value="delete_10d">Delete 10-Day</option>
              </select>
              <button
                onClick={handleAddSubdomain}
                disabled={!newSubdomain.trim()}
                className="px-3 py-1.5 text-sm bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Subdomain
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Main Component
export default function CriteriaManager() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [showAddDomain, setShowAddDomain] = useState(false);
  const [newDomainName, setNewDomainName] = useState('');
  const [newDomainAction, setNewDomainAction] = useState<Action | ''>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, refetch } = useCriteria();
  const addDomainMutation = useAddDomain();

  // Filter domains
  const filteredDomains = useMemo(() => {
    if (!data?.criteria) return [];

    let domains = Object.entries(data.criteria);

    // Apply action filter
    if (filter !== 'all') {
      domains = domains.filter(([, rules]) => {
        // Check default action
        if (rules.default === filter) return true;
        // Check patterns
        if (filter === 'keep' && rules.keep?.length) return true;
        if (filter === 'delete' && rules.delete?.length) return true;
        if (filter === 'delete_1d' && rules.delete_1d?.length) return true;
        if (filter === 'delete_10d' && rules.delete_10d?.length) return true;
        return false;
      });
    }

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      domains = domains.filter(([domain, rules]) => {
        if (domain.toLowerCase().includes(searchLower)) return true;
        // Search in patterns
        if (rules.keep?.some(p => p.toLowerCase().includes(searchLower))) return true;
        if (rules.delete?.some(p => p.toLowerCase().includes(searchLower))) return true;
        if (rules.delete_1d?.some(p => p.toLowerCase().includes(searchLower))) return true;
        if (rules.delete_10d?.some(p => p.toLowerCase().includes(searchLower))) return true;
        if (rules.excludeSubjects?.some(t => t.toLowerCase().includes(searchLower))) return true;
        // Search in subdomains
        if (rules.subdomains) {
          for (const subdomain of Object.keys(rules.subdomains)) {
            if (subdomain.toLowerCase().includes(searchLower)) return true;
          }
        }
        return false;
      });
    }

    return domains.sort((a, b) => a[0].localeCompare(b[0]));
  }, [data?.criteria, filter, search]);

  const toggleDomain = (domain: string) => {
    setExpandedDomains(prev => {
      const next = new Set(prev);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      return next;
    });
  };

  const handleAddDomain = () => {
    if (!newDomainName.trim()) return;
    addDomainMutation.mutate({
      domain: newDomainName.trim(),
      defaultAction: newDomainAction || undefined
    }, {
      onSuccess: () => {
        setNewDomainName('');
        setNewDomainAction('');
        setShowAddDomain(false);
        setExpandedDomains(prev => new Set(prev).add(newDomainName.trim().toLowerCase()));
      }
    });
  };

  const handleExport = () => {
    if (!data?.criteria) return;
    const blob = new Blob([JSON.stringify(data.criteria, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `criteria_unified_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const imported = JSON.parse(text) as UnifiedCriteria;

      // Validate structure
      if (typeof imported !== 'object') {
        throw new Error('Invalid format');
      }

      // Upload each domain
      for (const [domain, rules] of Object.entries(imported)) {
        await fetch(`/api/criteria/domain/${encodeURIComponent(domain)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rules)
        });
      }

      refetch();
      alert(`Imported ${Object.keys(imported).length} domains successfully!`);
    } catch (err) {
      alert('Failed to import: ' + (err as Error).message);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-gray-500">Loading criteria...</div>
      </div>
    );
  }

  const stats = data?.stats;
  const totalRules = filteredDomains.reduce((sum, [, rules]) => sum + countRules(rules), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Criteria Manager</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage email rules for {stats?.totalDomains || 0} domains
          </p>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{stats?.totalDomains || 0}</div>
          <div className="text-xs text-gray-500">Total Domains</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-red-600">{stats?.withDefault.delete || 0}</div>
          <div className="text-xs text-gray-500">Default Delete</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-orange-600">{stats?.withDefault.delete_1d || 0}</div>
          <div className="text-xs text-gray-500">Default Delete 1-Day</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-amber-600">{stats?.withDefault.delete_10d || 0}</div>
          <div className="text-xs text-gray-500">Default Delete 10-Day</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-green-600">{stats?.withDefault.keep || 0}</div>
          <div className="text-xs text-gray-500">Default Keep</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-purple-600">{stats?.withSubdomains || 0}</div>
          <div className="text-xs text-gray-500">With Subdomains</div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => setShowAddDomain(true)}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium"
        >
          + Add Domain
        </button>
        <button
          onClick={handleExport}
          className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
        >
          Export JSON
        </button>
        <label className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium cursor-pointer">
          Import JSON
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            className="hidden"
          />
        </label>
      </div>

      {/* Add Domain Modal */}
      {showAddDomain && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Add New Domain</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Domain Name</label>
                <input
                  type="text"
                  value={newDomainName}
                  onChange={e => setNewDomainName(e.target.value)}
                  placeholder="example.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Default Action (optional)</label>
                <select
                  value={newDomainAction}
                  onChange={e => setNewDomainAction(e.target.value as Action | '')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">None (Undecided)</option>
                  <option value="delete">Delete</option>
                  <option value="delete_1d">Delete 1-Day</option>
                  <option value="delete_10d">Delete 10-Day</option>
                  <option value="keep">Keep</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowAddDomain(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleAddDomain}
                disabled={!newDomainName.trim()}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
              >
                Add Domain
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'delete', 'delete_1d', 'delete_10d', 'keep'] as const).map(f => {
          const count = f === 'all'
            ? Object.keys(data?.criteria || {}).length
            : Object.values(data?.criteria || {}).filter(rules => {
                if (rules.default === f) return true;
                if (f === 'keep' && rules.keep?.length) return true;
                if (f === 'delete' && rules.delete?.length) return true;
                if (f === 'delete_1d' && rules.delete_1d?.length) return true;
                if (f === 'delete_10d' && rules.delete_10d?.length) return true;
                return false;
              }).length;

          const colors: Record<string, string> = {
            all: 'bg-blue-500',
            delete: 'bg-red-500',
            delete_1d: 'bg-orange-500',
            delete_10d: 'bg-amber-500',
            keep: 'bg-green-500'
          };

          const labels: Record<string, string> = {
            all: 'All',
            delete: 'Delete',
            delete_1d: 'Delete 1-Day',
            delete_10d: 'Delete 10-Day',
            keep: 'Keep'
          };

          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                filter === f
                  ? `${colors[f]} text-white`
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {labels[f]} ({count})
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="flex gap-4">
        <input
          type="text"
          placeholder="Search domain or pattern..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="px-4 py-2 text-gray-500 hover:text-gray-700"
          >
            Clear
          </button>
        )}
      </div>

      {/* Domain List */}
      <div className="space-y-2">
        {filteredDomains.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center text-gray-500">
            No domains found matching your criteria.
          </div>
        ) : (
          filteredDomains.map(([domain, rules]) => (
            <DomainCard
              key={domain}
              domain={domain}
              rules={rules}
              isExpanded={expandedDomains.has(domain)}
              onToggle={() => toggleDomain(domain)}
            />
          ))
        )}
      </div>

      <div className="text-sm text-gray-500">
        Showing {filteredDomains.length} domains with {totalRules} rules
      </div>
    </div>
  );
}
