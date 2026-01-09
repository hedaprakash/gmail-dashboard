import { useState } from 'react';
import type { DomainGroup, SubdomainGroup, AddCriteriaParams } from '../../hooks/useEmails';
import PatternItem from './PatternItem';

// NEW: Handlers receive raw email fields (TypeScript = dumb pipe)
type CriteriaHandler = (params: Omit<AddCriteriaParams, 'toEmail'>) => void;
type KeepHandler = (params: Omit<AddCriteriaParams, 'toEmail'> & { category: string }) => void;

interface DomainSectionProps {
  domain: DomainGroup;
  onKeep: KeepHandler;
  onDelete: CriteriaHandler;
  onDelete1d: CriteriaHandler;
  onDelete10d: CriteriaHandler;
}

interface SubdomainSectionProps {
  subdomain: SubdomainGroup;
  primaryDomain: string;
  onKeep: KeepHandler;
  onDelete: CriteriaHandler;
  onDelete1d: CriteriaHandler;
  onDelete10d: CriteriaHandler;
}

function SubdomainSection({ subdomain, primaryDomain, onKeep, onDelete, onDelete1d, onDelete10d }: SubdomainSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const hasMultipleSubdomains = subdomain.subdomain !== primaryDomain;

  // Get a sample sender from this subdomain's patterns (for the stored procedure to parse)
  const sampleSender = subdomain.patterns[0]?.sender || `_@${subdomain.subdomain}`;

  // Use raw email fields - stored procedure handles all business logic
  const handleKeepSubdomain = () => {
    onKeep({ fromEmail: sampleSender, subject: '', level: 'subdomain', category: 'SUBDOMAIN' });
  };

  const handleDeleteSubdomain = () => {
    onDelete({ fromEmail: sampleSender, subject: '', level: 'subdomain' });
  };

  const handleDelete1dSubdomain = () => {
    onDelete1d({ fromEmail: sampleSender, subject: '', level: 'subdomain' });
  };

  const handleDelete10dSubdomain = () => {
    onDelete10d({ fromEmail: sampleSender, subject: '', level: 'subdomain' });
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
              onKeep={(selectedText) => onKeep({
                fromEmail: pattern.sender,
                subject: pattern.subject,
                level: 'subdomain',
                subjectPattern: selectedText || undefined,
                category: pattern.category
              })}
              onDelete={(selectedText) => onDelete({
                fromEmail: pattern.sender,
                subject: pattern.subject,
                level: 'subdomain',
                subjectPattern: selectedText || undefined
              })}
              onDelete1d={(selectedText) => onDelete1d({
                fromEmail: pattern.sender,
                subject: pattern.subject,
                level: 'subdomain',
                subjectPattern: selectedText || undefined
              })}
              onDelete10d={(selectedText) => onDelete10d({
                fromEmail: pattern.sender,
                subject: pattern.subject,
                level: 'subdomain',
                subjectPattern: selectedText || undefined
              })}
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

  // Get a sample sender from this domain's patterns (for the stored procedure to parse)
  const sampleSender = domain.subdomains?.[0]?.patterns?.[0]?.sender || `_@${domain.domain}`;

  // Use raw email fields - stored procedure handles all business logic
  const handleKeepAll = () => {
    onKeep({ fromEmail: sampleSender, subject: '', level: 'domain', category: 'DOMAIN' });
  };

  const handleDeleteAll = () => {
    onDelete({ fromEmail: sampleSender, subject: '', level: 'domain' });
  };

  const handleDelete1dAll = () => {
    onDelete1d({ fromEmail: sampleSender, subject: '', level: 'domain' });
  };

  const handleDelete10dAll = () => {
    onDelete10d({ fromEmail: sampleSender, subject: '', level: 'domain' });
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
