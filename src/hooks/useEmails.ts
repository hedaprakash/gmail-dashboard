import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface EmailPattern {
  domain: string;
  subdomain: string;
  sender: string;
  subject: string;
  category: string;
  count: number;
  minDate: string;
  maxDate: string;
  messageIds: string[];
  categoryIcon: string;
  categoryColor: string;
  categoryBg: string;
  gmailUrl?: string;
}

export interface SubdomainGroup {
  subdomain: string;
  displayName: string;
  totalEmails: number;
  patterns: EmailPattern[];
}

export interface DomainGroup {
  domain: string;
  totalEmails: number;
  subdomains: SubdomainGroup[];
  patterns: EmailPattern[];
}

interface EmailsResponse {
  success: boolean;
  cacheFile: string;
  cacheAgeHours: number;
  totalEmails: number;
  filteredOut: number;
  undecidedEmails: number;
  domains: DomainGroup[];
}

interface StatsResponse {
  success: boolean;
  cacheFile: string;
  cacheAgeHours: number;
  stats: {
    total: number;
    matchedCriteria: number;
    matchedCriteria1d: number;
    matchedCriteria10d: number;
    matchedKeep: number;
    undecided: number;
    criteriaDomains: Record<string, number>;
    criteria1dDomains: Record<string, number>;
    criteria10dDomains: Record<string, number>;
    keepDomains: Record<string, number>;
  };
  criteriaRules: number;
  criteria1dRules: number;
  criteria10dRules: number;
  keepRules: number;
}

// Include credentials for session-based auth (multi-user support)
const fetchOptions: RequestInit = {
  credentials: 'include'
};

async function fetchEmails(): Promise<EmailsResponse> {
  const res = await fetch('/api/emails', fetchOptions);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to fetch emails');
  }
  return res.json();
}

async function fetchStats(): Promise<StatsResponse> {
  const res = await fetch('/api/emails/stats', fetchOptions);
  if (!res.ok) throw new Error('Failed to fetch stats');
  return res.json();
}

async function markKeep(domain: string, subjectPattern: string, category: string) {
  const res = await fetch('/api/actions/mark-keep', {
    ...fetchOptions,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, subject_pattern: subjectPattern, category })
  });
  if (!res.ok) throw new Error('Failed to mark keep');
  return res.json();
}

// NEW: Pass raw email fields to stored procedure (TypeScript = dumb pipe)
interface AddCriteriaParams {
  fromEmail: string;      // Raw sender email (e.g., 'noreply@custcomm.icicibank.com')
  toEmail?: string;       // Raw recipient email (optional)
  subject: string;        // Raw subject line
  level: 'domain' | 'subdomain' | 'from_email' | 'to_email';
  subjectPattern?: string; // Optional - if user selected text
}

async function addCriteria(params: AddCriteriaParams) {
  const res = await fetch('/api/actions/add-criteria', {
    ...fetchOptions,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromEmail: params.fromEmail,
      toEmail: params.toEmail,
      subject: params.subject,
      level: params.level,
      subject_pattern: params.subjectPattern
    })
  });
  if (!res.ok) throw new Error('Failed to add criteria');
  return res.json();
}

async function addCriteria1d(params: AddCriteriaParams) {
  const res = await fetch('/api/actions/add-criteria-1d', {
    ...fetchOptions,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromEmail: params.fromEmail,
      toEmail: params.toEmail,
      subject: params.subject,
      level: params.level,
      subject_pattern: params.subjectPattern
    })
  });
  if (!res.ok) throw new Error('Failed to add criteria');
  return res.json();
}

async function addCriteria10d(params: AddCriteriaParams) {
  const res = await fetch('/api/actions/add-criteria-10d', {
    ...fetchOptions,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromEmail: params.fromEmail,
      toEmail: params.toEmail,
      subject: params.subject,
      level: params.level,
      subject_pattern: params.subjectPattern
    })
  });
  if (!res.ok) throw new Error('Failed to add criteria');
  return res.json();
}

export function useEmails() {
  return useQuery({
    queryKey: ['emails'],
    queryFn: fetchEmails,
    retry: false
  });
}

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: fetchStats
  });
}

export function useMarkKeep() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ domain, subject, category }: { domain: string; subject: string; category: string }) =>
      markKeep(domain, subject, category),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    }
  });
}

export function useAddCriteria() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: AddCriteriaParams) => addCriteria(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    }
  });
}

export function useAddCriteria1d() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: AddCriteriaParams) => addCriteria1d(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    }
  });
}

export function useAddCriteria10d() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: AddCriteriaParams) => addCriteria10d(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    }
  });
}

// Export the interface for use in components
export type { AddCriteriaParams };

export function formatDateRange(minDate: string, maxDate: string, count: number): string {
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });

  if (count === 1) {
    return fmt(minDate);
  }
  return `${fmt(minDate)} - ${fmt(maxDate)}`;
}
