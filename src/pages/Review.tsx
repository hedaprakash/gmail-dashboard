import { useState, useMemo, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useEmails, useMarkKeep, useAddCriteria, useAddCriteria1d, useAddCriteria10d, formatDateRange } from '../hooks/useEmails';
import type { DomainGroup, AddCriteriaParams } from '../hooks/useEmails';
import StatsCard from '../components/Stats/StatsCard';
import DomainSection from '../components/Email/DomainSection';

const categories = ['All', 'PROMO', 'NEWSLETTER', 'UNKNOWN', 'SECURITY', 'ALERT', 'STATEMENT', 'ORDER'];

export default function Review() {
  const [categoryFilter, setCategoryFilter] = useState('All');
  const { data, isLoading, error } = useEmails();
  const markKeep = useMarkKeep();
  const addCriteria = useAddCriteria();
  const addCriteria1d = useAddCriteria1d();
  const addCriteria10d = useAddCriteria10d();

  // Snapshot sort: Store the frozen order of domains from initial load
  // This prevents list jumping when actions change email counts
  const frozenOrderRef = useRef<string[] | null>(null);
  const lastCacheFileRef = useRef<string | null>(null);

  // Capture frozen order on initial load or when cache file changes (explicit refresh)
  useEffect(() => {
    if (data?.domains && data.cacheFile) {
      // Only reset frozen order if this is a new cache file (explicit refresh)
      // or if we don't have a frozen order yet
      if (frozenOrderRef.current === null || lastCacheFileRef.current !== data.cacheFile) {
        // Sort by count descending and capture order
        const sortedByCount = [...data.domains].sort((a, b) => b.totalEmails - a.totalEmails);
        frozenOrderRef.current = sortedByCount.map(d => d.domain);
        lastCacheFileRef.current = data.cacheFile;
        console.log('Frozen order captured:', frozenOrderRef.current.slice(0, 5), '...');
      }
    }
  }, [data]);

  // Filter and sort domains using frozen order
  const filteredDomains = useMemo(() => {
    if (!data) return [];

    let domains: DomainGroup[] = data.domains;

    // Filter by category if needed
    if (categoryFilter !== 'All') {
      domains = domains.map(d => {
        // Filter patterns in each subdomain
        const filteredSubdomains = d.subdomains?.map(sub => ({
          ...sub,
          patterns: sub.patterns.filter(p => p.category === categoryFilter),
          totalEmails: sub.patterns.filter(p => p.category === categoryFilter).reduce((sum, p) => sum + p.count, 0)
        })).filter(sub => sub.patterns.length > 0) ?? [];

        return {
          ...d,
          subdomains: filteredSubdomains,
          patterns: d.patterns.filter(p => p.category === categoryFilter),
          totalEmails: filteredSubdomains.reduce((sum, sub) => sum + sub.totalEmails, 0)
        };
      }).filter(d => d.totalEmails > 0);
    }

    // Use frozen order if available, otherwise sort by count
    if (frozenOrderRef.current) {
      const orderMap = new Map(frozenOrderRef.current.map((d, i) => [d, i]));
      return [...domains].sort((a, b) => {
        const aIndex = orderMap.get(a.domain) ?? 999999;
        const bIndex = orderMap.get(b.domain) ?? 999999;
        return aIndex - bIndex;
      });
    } else {
      // Fallback: sort by count
      return [...domains].sort((a, b) => b.totalEmails - a.totalEmails);
    }
  }, [data, categoryFilter]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-gray-500">Loading emails...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
        <h2 className="text-lg font-semibold text-yellow-800 mb-2">No Cached Emails</h2>
        <p className="text-yellow-700 mb-4">
          {error instanceof Error ? error.message : 'Click "Refresh from Gmail" to fetch emails.'}
        </p>
      </div>
    );
  }

  if (!data) return null;

  // NEW: Handlers receive raw email fields (TypeScript = dumb pipe to stored procedure)
  const handleKeep = (params: Omit<AddCriteriaParams, 'toEmail'> & { category: string }) => {
    // TODO: Update markKeep to use new format - for now extract domain for backward compatibility
    const domain = params.fromEmail.includes('@') ? params.fromEmail.split('@')[1] : params.fromEmail;
    markKeep.mutate({ domain, subject: params.subjectPattern || '', category: params.category });
  };

  const handleDelete = (params: Omit<AddCriteriaParams, 'toEmail'>) => {
    addCriteria.mutate(params as AddCriteriaParams);
  };

  const handleDelete1d = (params: Omit<AddCriteriaParams, 'toEmail'>) => {
    addCriteria1d.mutate(params as AddCriteriaParams);
  };

  const handleDelete10d = (params: Omit<AddCriteriaParams, 'toEmail'>) => {
    addCriteria10d.mutate(params as AddCriteriaParams);
  };

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatsCard label="Total" value={data.totalEmails} color="blue" />
        <StatsCard label="Filtered Out" value={data.filteredOut} color="gray" />
        <StatsCard label="Need Review" value={data.undecidedEmails} color="yellow" />
        <StatsCard label="Domains" value={data.domains.length} color="purple" />
        <StatsCard
          label="Cache Age"
          value={`${data.cacheAgeHours}h`}
          color={data.cacheAgeHours > 5 ? 'red' : 'green'}
        />
      </div>

      {/* Category Filters */}
      <div className="flex flex-wrap gap-2">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              categoryFilter === cat
                ? 'bg-blue-500 text-white'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Domain List */}
      <div className="space-y-4">
        {filteredDomains.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No emails match the selected filter.
          </div>
        ) : (
          filteredDomains.map(domain => (
            <DomainSection
              key={domain.domain}
              domain={domain}
              onKeep={handleKeep}
              onDelete={handleDelete}
              onDelete1d={handleDelete1d}
              onDelete10d={handleDelete10d}
            />
          ))
        )}
      </div>
    </div>
  );
}
