import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Types for the unified criteria format
export type Action = 'delete' | 'delete_1d' | 'delete_10d' | 'keep';

export interface DomainRules {
  default?: Action | null;
  excludeSubjects?: string[];
  keep?: string[];
  delete?: string[];
  delete_1d?: string[];
  delete_10d?: string[];
  subdomains?: { [subdomain: string]: DomainRules };
}

export interface UnifiedCriteria {
  [primaryDomain: string]: DomainRules;
}

export interface CriteriaStats {
  totalDomains: number;
  withDefault: { delete: number; delete_1d: number; delete_10d: number; keep: number };
  withSubjectPatterns: number;
  withSubdomains: number;
  withExcludeSubjects: number;
}

interface CriteriaResponse {
  success: boolean;
  criteria: UnifiedCriteria;
  stats: CriteriaStats;
}

interface DomainRulesResponse {
  success: boolean;
  domain: string;
  rules: DomainRules;
}

// Flattened view for table display
export interface FlattenedRule {
  domain: string;
  subdomain?: string;
  action: Action | 'default';
  type: 'default' | 'pattern' | 'exclude';
  value: string;
}

// Flatten unified criteria into a table-friendly format
export function flattenCriteria(criteria: UnifiedCriteria): FlattenedRule[] {
  const rules: FlattenedRule[] = [];

  for (const [domain, domainRules] of Object.entries(criteria)) {
    // Add default action
    if (domainRules.default) {
      rules.push({
        domain,
        action: domainRules.default,
        type: 'default',
        value: '(all emails)'
      });
    }

    // Add exclude subjects
    if (domainRules.excludeSubjects?.length) {
      for (const term of domainRules.excludeSubjects) {
        rules.push({
          domain,
          action: 'default',
          type: 'exclude',
          value: term
        });
      }
    }

    // Add patterns
    for (const action of ['keep', 'delete', 'delete_1d', 'delete_10d'] as const) {
      const patterns = domainRules[action];
      if (patterns?.length) {
        for (const pattern of patterns) {
          rules.push({
            domain,
            action,
            type: 'pattern',
            value: pattern
          });
        }
      }
    }

    // Add subdomain rules
    if (domainRules.subdomains) {
      for (const [subdomain, subRules] of Object.entries(domainRules.subdomains)) {
        if (subRules.default) {
          rules.push({
            domain,
            subdomain,
            action: subRules.default,
            type: 'default',
            value: '(all emails)'
          });
        }

        for (const action of ['keep', 'delete', 'delete_1d', 'delete_10d'] as const) {
          const patterns = subRules[action];
          if (patterns?.length) {
            for (const pattern of patterns) {
              rules.push({
                domain,
                subdomain,
                action,
                type: 'pattern',
                value: pattern
              });
            }
          }
        }
      }
    }
  }

  // Sort by domain
  rules.sort((a, b) => a.domain.localeCompare(b.domain));

  return rules;
}

async function fetchAllCriteria(): Promise<CriteriaResponse> {
  const res = await fetch('/api/criteria');
  if (!res.ok) throw new Error('Failed to fetch criteria');
  return res.json();
}

async function fetchDomainCriteria(domain: string): Promise<DomainRulesResponse> {
  const res = await fetch(`/api/criteria/domain/${encodeURIComponent(domain)}`);
  if (!res.ok) throw new Error('Failed to fetch domain criteria');
  return res.json();
}

async function addRule(domain: string, action: Action, subjectPattern?: string, subdomain?: string) {
  const res = await fetch('/api/criteria/rule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, action, subjectPattern, subdomain })
  });
  if (!res.ok) throw new Error('Failed to add rule');
  return res.json();
}

async function deleteRule(domain: string, action?: Action, subjectPattern?: string, subdomain?: string) {
  const res = await fetch('/api/criteria/rule', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, action, subjectPattern, subdomain })
  });
  if (!res.ok) throw new Error('Failed to delete rule');
  return res.json();
}

async function deleteDomain(domain: string) {
  const res = await fetch(`/api/criteria/domain/${encodeURIComponent(domain)}`, {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error('Failed to delete domain');
  return res.json();
}

async function updateDomainRules(domain: string, rules: DomainRules) {
  const res = await fetch(`/api/criteria/domain/${encodeURIComponent(domain)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rules)
  });
  if (!res.ok) throw new Error('Failed to update domain');
  return res.json();
}

export function useCriteria() {
  return useQuery({
    queryKey: ['criteria'],
    queryFn: fetchAllCriteria
  });
}

export function useDomainCriteria(domain: string) {
  return useQuery({
    queryKey: ['criteria', 'domain', domain],
    queryFn: () => fetchDomainCriteria(domain),
    enabled: !!domain
  });
}

export function useAddRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ domain, action, subjectPattern, subdomain }: {
      domain: string;
      action: Action;
      subjectPattern?: string;
      subdomain?: string;
    }) => addRule(domain, action, subjectPattern, subdomain),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['criteria'] });
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    }
  });
}

export function useDeleteRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ domain, action, subjectPattern, subdomain }: {
      domain: string;
      action?: Action;
      subjectPattern?: string;
      subdomain?: string;
    }) => deleteRule(domain, action, subjectPattern, subdomain),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['criteria'] });
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    }
  });
}

export function useDeleteDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (domain: string) => deleteDomain(domain),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['criteria'] });
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    }
  });
}

export function useUpdateDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ domain, rules }: { domain: string; rules: DomainRules }) =>
      updateDomainRules(domain, rules),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['criteria'] });
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    }
  });
}

// Add exclude subjects to a domain
async function addExcludeSubjects(domain: string, terms: string[]) {
  const res = await fetch('/api/criteria/exclude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, terms })
  });
  if (!res.ok) throw new Error('Failed to add exclude subjects');
  return res.json();
}

export function useAddExcludeSubjects() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ domain, terms }: { domain: string; terms: string[] }) =>
      addExcludeSubjects(domain, terms),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['criteria'] });
    }
  });
}

// Remove exclude subject from a domain
async function removeExcludeSubject(domain: string, term: string) {
  // Need to load current rules, remove the term, and save
  const res = await fetch(`/api/criteria/domain/${encodeURIComponent(domain)}`);
  if (!res.ok) throw new Error('Failed to load domain');
  const data = await res.json();

  const rules = data.rules as DomainRules;
  if (rules.excludeSubjects) {
    rules.excludeSubjects = rules.excludeSubjects.filter(t => t.toLowerCase() !== term.toLowerCase());
    if (rules.excludeSubjects.length === 0) {
      delete rules.excludeSubjects;
    }
  }

  const updateRes = await fetch(`/api/criteria/domain/${encodeURIComponent(domain)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rules)
  });
  if (!updateRes.ok) throw new Error('Failed to update domain');
  return updateRes.json();
}

export function useRemoveExcludeSubject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ domain, term }: { domain: string; term: string }) =>
      removeExcludeSubject(domain, term),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['criteria'] });
    }
  });
}

// Set default action for a domain
async function setDefaultAction(domain: string, action: Action | null) {
  const res = await fetch(`/api/criteria/domain/${encodeURIComponent(domain)}`);
  let rules: DomainRules = {};

  if (res.ok) {
    const data = await res.json();
    rules = data.rules || {};
  }

  if (action) {
    rules.default = action;
  } else {
    delete rules.default;
  }

  const updateRes = await fetch(`/api/criteria/domain/${encodeURIComponent(domain)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rules)
  });
  if (!updateRes.ok) throw new Error('Failed to set default action');
  return updateRes.json();
}

export function useSetDefaultAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ domain, action }: { domain: string; action: Action | null }) =>
      setDefaultAction(domain, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['criteria'] });
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    }
  });
}

// Add a new domain with initial rules
async function addDomain(domain: string, defaultAction?: Action) {
  const rules: DomainRules = {};
  if (defaultAction) {
    rules.default = defaultAction;
  }

  const res = await fetch(`/api/criteria/domain/${encodeURIComponent(domain.toLowerCase())}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rules)
  });
  if (!res.ok) throw new Error('Failed to add domain');
  return res.json();
}

export function useAddDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ domain, defaultAction }: { domain: string; defaultAction?: Action }) =>
      addDomain(domain, defaultAction),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['criteria'] });
    }
  });
}

// Add subdomain rule
async function addSubdomainRule(domain: string, subdomain: string, action: Action) {
  const res = await fetch(`/api/criteria/domain/${encodeURIComponent(domain)}`);
  let rules: DomainRules = {};

  if (res.ok) {
    const data = await res.json();
    rules = data.rules || {};
  }

  if (!rules.subdomains) {
    rules.subdomains = {};
  }
  rules.subdomains[subdomain.toLowerCase()] = { default: action };

  const updateRes = await fetch(`/api/criteria/domain/${encodeURIComponent(domain)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rules)
  });
  if (!updateRes.ok) throw new Error('Failed to add subdomain');
  return updateRes.json();
}

export function useAddSubdomainRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ domain, subdomain, action }: { domain: string; subdomain: string; action: Action }) =>
      addSubdomainRule(domain, subdomain, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['criteria'] });
    }
  });
}

// Remove subdomain rule
async function removeSubdomainRule(domain: string, subdomain: string) {
  const res = await fetch(`/api/criteria/domain/${encodeURIComponent(domain)}`);
  if (!res.ok) throw new Error('Failed to load domain');
  const data = await res.json();

  const rules = data.rules as DomainRules;
  if (rules.subdomains) {
    delete rules.subdomains[subdomain.toLowerCase()];
    if (Object.keys(rules.subdomains).length === 0) {
      delete rules.subdomains;
    }
  }

  const updateRes = await fetch(`/api/criteria/domain/${encodeURIComponent(domain)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rules)
  });
  if (!updateRes.ok) throw new Error('Failed to remove subdomain');
  return updateRes.json();
}

export function useRemoveSubdomainRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ domain, subdomain }: { domain: string; subdomain: string }) =>
      removeSubdomainRule(domain, subdomain),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['criteria'] });
    }
  });
}

// Legacy exports for backwards compatibility
export type CriteriaEntry = {
  email: string;
  subdomain: string;
  primaryDomain: string;
  subject: string;
  toEmails: string;
  ccEmails: string;
  excludeSubject: string;
};

// Legacy hooks (deprecated)
export function useDeleteCriteria() {
  return useDeleteRule();
}

export function useMoveCriteria() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ fromType, toType, domain, pattern }: {
      fromType: Action;
      toType: Action;
      domain: string;
      pattern?: string;
    }) => {
      // Delete from old, add to new
      await deleteRule(domain, fromType, pattern);
      await addRule(domain, toType, pattern);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['criteria'] });
    }
  });
}
