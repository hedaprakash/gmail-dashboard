// Shared TypeScript types

export interface CriteriaEntry {
  email: string;
  subdomain: string;
  primaryDomain: string;
  subject: string;
  toEmails: string;
  ccEmails: string;
  excludeSubject: string;
}

export interface EmailData {
  id: string;
  email: string;
  from: string;
  subdomain: string;
  primaryDomain: string;
  subject: string;
  toEmails: string;
  ccEmails: string;
  date: string;
  category: string;
  categoryIcon: string;
  categoryColor: string;
  categoryBg: string;
  matchedKeyword: string | null;
}

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

export interface CategoryInfo {
  color: string;
  bgColor: string;
  icon: string;
  description: string;
  keywords: string[];
}

export interface ClassificationResult {
  category: string;
  color: string;
  bgColor: string;
  icon: string;
  description: string;
  matchedKeyword: string | null;
}

export interface StatsResponse {
  total: number;
  matchedCriteria: number;
  matchedCriteria1d: number;
  matchedKeep: number;
  undecided: number;
  criteriaDomains: Record<string, number>;
  criteria1dDomains: Record<string, number>;
  keepDomains: Record<string, number>;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  error?: string;
  data?: T;
}
