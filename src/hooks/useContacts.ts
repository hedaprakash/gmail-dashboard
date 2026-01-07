import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface Contact {
  id: number;
  googleResourceName: string;
  displayName: string | null;
  givenName: string | null;
  familyName: string | null;
  photoUrl: string | null;
  organization: string | null;
  jobTitle: string | null;
  notes: string | null;
  birthday: string | null;
  lastSynced: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
  emailCount: number;
  phoneCount: number;
}

export interface ContactDetails extends Contact {
  emails: Array<{ id: number; email: string; type: string | null; isPrimary: boolean }>;
  phones: Array<{ id: number; phone: string; type: string | null; isPrimary: boolean }>;
  emailCountFromContact: number;
}

export interface ContactStats {
  totalContacts: number;
  withOrganization: number;
  totalEmails: number;
  totalPhones: number;
  oldestSync: string | null;
  newestSync: string | null;
}

interface ContactsResponse {
  success: boolean;
  contacts: Contact[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

interface ContactStatsResponse {
  success: boolean;
  stats: ContactStats;
}

interface ContactDetailsResponse {
  success: boolean;
  contact: ContactDetails;
}

interface SyncResponse {
  success: boolean;
  message: string;
  result: {
    synced: number;
    created: number;
    updated: number;
    errors: number;
    errorMessages: string[];
  };
}

interface FindContactResponse {
  success: boolean;
  found: boolean;
  contact: {
    id: number;
    displayName: string;
    photoUrl: string | null;
    organization: string | null;
    matchedEmail: string;
  } | null;
}

const fetchOptions: RequestInit = {
  credentials: 'include'
};

async function fetchContacts(params: { search?: string; offset?: number; limit?: number }): Promise<ContactsResponse> {
  const searchParams = new URLSearchParams();
  if (params.search) searchParams.set('q', params.search);
  if (params.offset) searchParams.set('offset', params.offset.toString());
  if (params.limit) searchParams.set('limit', params.limit.toString());

  const url = `/api/contacts${searchParams.toString() ? `?${searchParams}` : ''}`;
  const res = await fetch(url, fetchOptions);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to fetch contacts');
  }
  return res.json();
}

async function fetchContactStats(): Promise<ContactStatsResponse> {
  const res = await fetch('/api/contacts/stats', fetchOptions);
  if (!res.ok) throw new Error('Failed to fetch contact stats');
  return res.json();
}

async function fetchContactDetails(contactId: number): Promise<ContactDetailsResponse> {
  const res = await fetch(`/api/contacts/${contactId}`, fetchOptions);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to fetch contact details');
  }
  return res.json();
}

async function findContactByEmail(email: string): Promise<FindContactResponse> {
  const res = await fetch(`/api/contacts/by-email/${encodeURIComponent(email)}`, fetchOptions);
  if (!res.ok) throw new Error('Failed to find contact');
  return res.json();
}

async function syncContacts(): Promise<SyncResponse> {
  const res = await fetch('/api/contacts/sync', {
    ...fetchOptions,
    method: 'POST'
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to sync contacts');
  }
  return res.json();
}

export function useContacts(search?: string, offset = 0, limit = 50) {
  return useQuery({
    queryKey: ['contacts', { search, offset, limit }],
    queryFn: () => fetchContacts({ search, offset, limit }),
    retry: false
  });
}

export function useContactStats() {
  return useQuery({
    queryKey: ['contacts', 'stats'],
    queryFn: fetchContactStats
  });
}

export function useContactDetails(contactId: number | null) {
  return useQuery({
    queryKey: ['contacts', 'details', contactId],
    queryFn: () => fetchContactDetails(contactId!),
    enabled: contactId !== null
  });
}

export function useFindContactByEmail(email: string | null) {
  return useQuery({
    queryKey: ['contacts', 'by-email', email],
    queryFn: () => findContactByEmail(email!),
    enabled: email !== null && email.length > 0
  });
}

export function useSyncContacts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: syncContacts,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    }
  });
}
