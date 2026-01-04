import { useState } from 'react';
import type { DomainGroup, SubdomainGroup } from '../../hooks/useEmails';
import PatternItem from './PatternItem';

interface DomainSectionProps {
  domain: DomainGroup;
  onKeep: (domain: string, subject: string, category: string) => void;
  onDelete: (domain: string, subject: string) => void;
  onDelete1d: (domain: string, subject: string) => void;
  onDelete10d: (domain: string, subject: string) => void;
}

interface SubdomainSectionProps {
  subdomain: SubdomainGroup;
  primaryDomain: string;
  onKeep: (domain: string, subject: string, category: string) => void;
  onDelete: (domain: string, subject: string) => void;
  onDelete1d: (domain: string, subject: string) => void;
  onDelete10d: (domain: string, subject: string) => void;
}

function SubdomainSection({ subdomain, primaryDomain, onKeep, onDelete, onDelete1d, onDelete10d }: SubdomainSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const hasMultipleSubdomains = subdomain.subdomain !== primaryDomain;

  // Use full subdomain for actions (e.g., alerts.sbi.co.in)
  const handleKeepSubdomain = () => {
    onKeep(subdomain.subdomain, '', 'SUBDOMAIN');
  };

  const handleDeleteSubdomain = () => {
    onDelete(subdomain.subdomain, '');
  };

  const handleDelete1dSubdomain = () => {
    onDelete1d(subdomain.subdomain, '');
  };

  const handleDelete10dSubdomain = () => {
    onDelete10d(subdomain.subdomain, '');
  };

  return (
    <div className="border-l-4 border-blue-200">
      {/* Subdomain Header - only show if different from primary */}
      {hasMultipleSubdomains && (
        <div className="bg-gray-100 border-b border-gray-200">
          <div className="flex items-center px-4 py-2">
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-2 flex-1 text-left text-gray-700"
            >
              <span className="text-sm">{expanded ? '▼' : '▶'}</span>
              <span className="font-medium text-sm">
                {subdomain.displayName === '(direct)' ? (
                  <span className="text-gray-500 italic">@ {primaryDomain}</span>
                ) : (
                  <>
                    <span className="text-blue-600">{subdomain.displayName}</span>
                    <span className="text-gray-400">.{primaryDomain}</span>
                  </>
                )}
              </span>
              <span className="bg-gray-300 px-2 py-0.5 rounded-full text-xs text-gray-700">
                {subdomain.totalEmails}
              </span>
            </button>

            {/* Subdomain-level action buttons */}
            <div className="flex gap-1">
              <button
                onClick={handleKeepSubdomain}
                className="px-2 py-0.5 text-xs font-medium bg-green-500 hover:bg-green-600 text-white rounded"
                title={`Keep all from ${subdomain.subdomain}`}
              >
                Keep
              </button>
              <button
                onClick={handleDeleteSubdomain}
                className="px-2 py-0.5 text-xs font-medium bg-red-500 hover:bg-red-600 text-white rounded"
                title={`Delete all from ${subdomain.subdomain}`}
              >
                Del
              </button>
              <button
                onClick={handleDelete1dSubdomain}
                className="px-2 py-0.5 text-xs font-medium bg-orange-500 hover:bg-orange-600 text-white rounded"
                title={`Delete after 1 day from ${subdomain.subdomain}`}
              >
                1d
              </button>
              <button
                onClick={handleDelete10dSubdomain}
                className="px-2 py-0.5 text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white rounded"
                title={`Delete after 10 days from ${subdomain.subdomain}`}
              >
                10d
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pattern List */}
      {expanded && (
        <div className="divide-y divide-gray-100">
          {subdomain.patterns.map((pattern, idx) => (
            <PatternItem
              key={`${pattern.subdomain}-${pattern.subject}-${idx}`}
              pattern={pattern}
              showSender={true}
              onKeep={(selectedText) => onKeep(pattern.subdomain, selectedText ?? pattern.subject, pattern.category)}
              onDelete={(selectedText) => onDelete(pattern.subdomain, selectedText ?? pattern.subject)}
              onDelete1d={(selectedText) => onDelete1d(pattern.subdomain, selectedText ?? pattern.subject)}
              onDelete10d={(selectedText) => onDelete10d(pattern.subdomain, selectedText ?? pattern.subject)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DomainSection({ domain, onKeep, onDelete, onDelete1d, onDelete10d }: DomainSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const hasSubdomains = domain.subdomains && domain.subdomains.length > 1;

  const handleKeepAll = () => {
    onKeep(domain.domain, '', 'DOMAIN');
  };

  const handleDeleteAll = () => {
    onDelete(domain.domain, '');
  };

  const handleDelete1dAll = () => {
    onDelete1d(domain.domain, '');
  };

  const handleDelete10dAll = () => {
    onDelete10d(domain.domain, '');
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* Domain Header */}
      <div className="bg-blue-500 text-white">
        <div className="flex items-center px-4 py-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-3 flex-1 text-left"
          >
            <span className="text-lg">{expanded ? '▼' : '▶'}</span>
            <span className="font-semibold">{domain.domain}</span>
            <span className="bg-white/20 px-2 py-0.5 rounded-full text-sm">
              {domain.totalEmails} emails
            </span>
            {hasSubdomains && (
              <span className="bg-white/10 px-2 py-0.5 rounded-full text-xs">
                {domain.subdomains.length} subdomains
              </span>
            )}
          </button>

          {/* Domain-level action buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleKeepAll}
              className="px-3 py-1 text-xs font-medium bg-green-500 hover:bg-green-600 rounded"
            >
              Keep All
            </button>
            <button
              onClick={handleDeleteAll}
              className="px-3 py-1 text-xs font-medium bg-red-500 hover:bg-red-600 rounded"
            >
              Del All
            </button>
            <button
              onClick={handleDelete1dAll}
              className="px-3 py-1 text-xs font-medium bg-orange-500 hover:bg-orange-600 rounded"
            >
              Del 1d
            </button>
            <button
              onClick={handleDelete10dAll}
              className="px-3 py-1 text-xs font-medium bg-amber-600 hover:bg-amber-700 rounded"
            >
              Del 10d
            </button>
          </div>
        </div>
      </div>

      {/* Subdomain List */}
      {expanded && domain.subdomains && (
        <div>
          {domain.subdomains.map((subdomain) => (
            <SubdomainSection
              key={subdomain.subdomain}
              subdomain={subdomain}
              primaryDomain={domain.domain}
              onKeep={onKeep}
              onDelete={onDelete}
              onDelete1d={onDelete1d}
              onDelete10d={onDelete10d}
            />
          ))}
        </div>
      )}
    </div>
  );
}
