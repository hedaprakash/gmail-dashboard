import { useStats } from '../hooks/useEmails';
import StatsCard from '../components/Stats/StatsCard';

export default function Stats() {
  const { data, isLoading, error } = useStats();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-gray-500">Loading statistics...</div>
      </div>
    );
  }

  if (error || !data?.success) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
        <h2 className="text-lg font-semibold text-yellow-800 mb-2">No Data Available</h2>
        <p className="text-yellow-700">Refresh from Gmail to load email statistics.</p>
      </div>
    );
  }

  const { stats, criteriaStats } = data;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Email Statistics</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatsCard label="Total Emails" value={stats.total} color="blue" />
        <StatsCard label="Will Delete" value={stats.matchedDelete} color="red" />
        <StatsCard label="Delete 1-Day" value={stats.matchedDelete1d} color="yellow" />
        <StatsCard label="Protected" value={stats.matchedKeep} color="green" />
        <StatsCard label="Need Review" value={stats.undecided} color="purple" />
      </div>

      {/* Criteria Rules - Unified Format */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4">Criteria Rules (Unified)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-4 bg-blue-50 rounded-lg">
            <div className="text-2xl font-bold text-blue-600">{criteriaStats?.totalDomains || 0}</div>
            <div className="text-sm text-blue-700">Total Domains</div>
          </div>
          <div className="text-center p-4 bg-red-50 rounded-lg">
            <div className="text-2xl font-bold text-red-600">{criteriaStats?.withDefault?.delete || 0}</div>
            <div className="text-sm text-red-700">Default Delete</div>
          </div>
          <div className="text-center p-4 bg-orange-50 rounded-lg">
            <div className="text-2xl font-bold text-orange-600">{criteriaStats?.withDefault?.delete_1d || 0}</div>
            <div className="text-sm text-orange-700">Default Delete 1-Day</div>
          </div>
          <div className="text-center p-4 bg-green-50 rounded-lg">
            <div className="text-2xl font-bold text-green-600">{criteriaStats?.withDefault?.keep || 0}</div>
            <div className="text-sm text-green-700">Default Keep</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4">
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-xl font-bold text-gray-600">{criteriaStats?.withSubjectPatterns || 0}</div>
            <div className="text-xs text-gray-500">With Subject Patterns</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-xl font-bold text-gray-600">{criteriaStats?.withSubdomains || 0}</div>
            <div className="text-xs text-gray-500">With Subdomains</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-xl font-bold text-gray-600">{criteriaStats?.withExcludeSubjects || 0}</div>
            <div className="text-xs text-gray-500">With Exclusions</div>
          </div>
        </div>
      </div>

      {/* Top Domains by Category */}
      <div className="grid md:grid-cols-3 gap-6">
        {/* Delete Domains */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="font-semibold text-red-700 mb-3">Top Delete Domains</h3>
          <ul className="space-y-2">
            {stats.deleteDomains && Object.entries(stats.deleteDomains).map(([domain, count]) => (
              <li key={domain} className="flex justify-between text-sm">
                <span className="text-gray-700 truncate">{domain}</span>
                <span className="text-red-600 font-medium">{count as number}</span>
              </li>
            ))}
            {(!stats.deleteDomains || Object.keys(stats.deleteDomains).length === 0) && (
              <li className="text-gray-400 text-sm">No domains</li>
            )}
          </ul>
        </div>

        {/* Delete 1-Day Domains */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="font-semibold text-orange-700 mb-3">Top Delete 1-Day Domains</h3>
          <ul className="space-y-2">
            {stats.delete1dDomains && Object.entries(stats.delete1dDomains).map(([domain, count]) => (
              <li key={domain} className="flex justify-between text-sm">
                <span className="text-gray-700 truncate">{domain}</span>
                <span className="text-orange-600 font-medium">{count as number}</span>
              </li>
            ))}
            {(!stats.delete1dDomains || Object.keys(stats.delete1dDomains).length === 0) && (
              <li className="text-gray-400 text-sm">No domains</li>
            )}
          </ul>
        </div>

        {/* Keep Domains */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="font-semibold text-green-700 mb-3">Top Protected Domains</h3>
          <ul className="space-y-2">
            {stats.keepDomains && Object.entries(stats.keepDomains).map(([domain, count]) => (
              <li key={domain} className="flex justify-between text-sm">
                <span className="text-gray-700 truncate">{domain}</span>
                <span className="text-green-600 font-medium">{count as number}</span>
              </li>
            ))}
            {(!stats.keepDomains || Object.keys(stats.keepDomains).length === 0) && (
              <li className="text-gray-400 text-sm">No domains</li>
            )}
          </ul>
        </div>
      </div>

      {/* Cache Info */}
      <div className="text-sm text-gray-500 text-center">
        Cache: {data.cacheFile} ({data.cacheAgeHours} hours old)
      </div>
    </div>
  );
}
