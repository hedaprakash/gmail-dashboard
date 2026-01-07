import { useState } from 'react';
import {
  useContacts,
  useContactStats,
  useContactDetails,
  useSyncContacts,
  type Contact,
  type ContactDetails
} from '../hooks/useContacts';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function ContactCard({
  contact,
  onClick
}: {
  contact: Contact;
  onClick: () => void;
}) {
  return (
    <div
      className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="flex-shrink-0">
          {contact.photoUrl ? (
            <img
              src={contact.photoUrl}
              alt={contact.displayName || 'Contact'}
              className="w-12 h-12 rounded-full object-cover"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-lg">
              {contact.displayName?.[0]?.toUpperCase() || '?'}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-gray-900 truncate">
            {contact.displayName || 'No Name'}
          </h3>
          {contact.organization && (
            <p className="text-sm text-gray-600 truncate">{contact.organization}</p>
          )}
          {contact.primaryEmail && (
            <p className="text-sm text-gray-500 truncate">{contact.primaryEmail}</p>
          )}
          {contact.primaryPhone && (
            <p className="text-sm text-gray-500 truncate">{contact.primaryPhone}</p>
          )}
        </div>

        {/* Counts */}
        <div className="flex-shrink-0 text-right">
          {contact.emailCount > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700">
              {contact.emailCount} email{contact.emailCount !== 1 ? 's' : ''}
            </span>
          )}
          {contact.phoneCount > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-green-50 text-green-700 ml-1">
              {contact.phoneCount} phone{contact.phoneCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ContactDetailsModal({
  contactId,
  onClose
}: {
  contactId: number;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useContactDetails(contactId);

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      </div>
    );
  }

  if (error || !data?.contact) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl p-6 max-w-md">
          <p className="text-red-600">Failed to load contact details</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-gray-200 rounded">
            Close
          </button>
        </div>
      </div>
    );
  }

  const contact = data.contact;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-4 p-6 border-b border-gray-200">
          {contact.photoUrl ? (
            <img
              src={contact.photoUrl}
              alt={contact.displayName || 'Contact'}
              className="w-16 h-16 rounded-full object-cover"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-2xl">
              {contact.displayName?.[0]?.toUpperCase() || '?'}
            </div>
          )}
          <div className="flex-1">
            <h2 className="text-xl font-bold text-gray-900">
              {contact.displayName || 'No Name'}
            </h2>
            {contact.organization && (
              <p className="text-gray-600">{contact.organization}</p>
            )}
            {contact.jobTitle && (
              <p className="text-sm text-gray-500">{contact.jobTitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full"
          >
            <span className="text-2xl text-gray-400">&times;</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Emails */}
          {contact.emails.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Email Addresses</h3>
              <div className="space-y-2">
                {contact.emails.map(email => (
                  <div key={email.id} className="flex items-center gap-2">
                    <span className="text-blue-600">{email.email}</span>
                    {email.type && (
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                        {email.type}
                      </span>
                    )}
                    {email.isPrimary && (
                      <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">
                        Primary
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Phones */}
          {contact.phones.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Phone Numbers</h3>
              <div className="space-y-2">
                {contact.phones.map(phone => (
                  <div key={phone.id} className="flex items-center gap-2">
                    <span className="text-gray-900">{phone.phone}</span>
                    {phone.type && (
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                        {phone.type}
                      </span>
                    )}
                    {phone.isPrimary && (
                      <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">
                        Primary
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Birthday */}
          {contact.birthday && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-1">Birthday</h3>
              <p className="text-gray-600">{contact.birthday}</p>
            </div>
          )}

          {/* Notes */}
          {contact.notes && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-1">Notes</h3>
              <p className="text-gray-600 whitespace-pre-wrap">{contact.notes}</p>
            </div>
          )}

          {/* Email count from this contact */}
          {contact.emailCountFromContact > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-blue-800">
                <span className="font-semibold">{contact.emailCountFromContact}</span> email{contact.emailCountFromContact !== 1 ? 's' : ''} in your inbox from this contact
              </p>
            </div>
          )}

          {/* Metadata */}
          <div className="text-xs text-gray-500 pt-4 border-t border-gray-200">
            <p>Last synced: {formatDate(contact.lastSynced)}</p>
            <p className="text-gray-400 truncate">ID: {contact.googleResourceName}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Contacts() {
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);
  const limit = 50;

  const { data: contactsData, isLoading: loadingContacts, error: contactsError } = useContacts(
    search || undefined,
    offset,
    limit
  );
  const { data: statsData, isLoading: loadingStats } = useContactStats();
  const syncMutation = useSyncContacts();

  const handleSync = () => {
    if (syncMutation.isPending) return;
    syncMutation.mutate();
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setOffset(0);
  };

  const handleNextPage = () => {
    if (contactsData?.hasMore) {
      setOffset(offset + limit);
    }
  };

  const handlePrevPage = () => {
    setOffset(Math.max(0, offset - limit));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Contacts</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage your Google Contacts
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncMutation.isPending}
          className={`px-4 py-2 rounded-lg font-medium text-white transition-colors ${
            syncMutation.isPending
              ? 'bg-blue-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {syncMutation.isPending ? (
            <>
              <span className="inline-block animate-spin mr-2">&#8635;</span>
              Syncing...
            </>
          ) : (
            'Sync from Google'
          )}
        </button>
      </div>

      {/* Sync Result */}
      {syncMutation.isSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-800">
          <p className="font-medium">Sync Complete!</p>
          <p className="text-sm mt-1">
            {syncMutation.data.result.synced} contacts synced
            ({syncMutation.data.result.created} created, {syncMutation.data.result.updated} updated)
          </p>
          {syncMutation.data.result.errors > 0 && (
            <p className="text-sm text-red-600 mt-1">
              {syncMutation.data.result.errors} errors occurred
            </p>
          )}
        </div>
      )}

      {syncMutation.isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          <p className="font-medium">Sync Failed</p>
          <p className="text-sm mt-1">{syncMutation.error?.message}</p>
        </div>
      )}

      {/* Stats */}
      {!loadingStats && statsData?.stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-blue-600">
              {statsData.stats.totalContacts}
            </div>
            <div className="text-xs text-gray-500">Total Contacts</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-purple-600">
              {statsData.stats.withOrganization}
            </div>
            <div className="text-xs text-gray-500">With Organization</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-green-600">
              {statsData.stats.totalEmails}
            </div>
            <div className="text-xs text-gray-500">Email Addresses</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-orange-600">
              {statsData.stats.totalPhones}
            </div>
            <div className="text-xs text-gray-500">Phone Numbers</div>
          </div>
        </div>
      )}

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-4">
        <input
          type="text"
          placeholder="Search contacts by name, email, or organization..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {search && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setOffset(0);
            }}
            className="px-4 py-2 text-gray-500 hover:text-gray-700"
          >
            Clear
          </button>
        )}
      </form>

      {/* Loading */}
      {loadingContacts && (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      )}

      {/* Error */}
      {contactsError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-600">Failed to load contacts</p>
          <p className="text-sm text-red-500 mt-1">{(contactsError as Error).message}</p>
        </div>
      )}

      {/* No Contacts */}
      {!loadingContacts && !contactsError && contactsData?.contacts.length === 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <div className="text-4xl mb-4">&#128100;</div>
          <h3 className="text-lg font-medium text-gray-900">No Contacts Found</h3>
          <p className="text-gray-500 mt-2">
            {search
              ? 'No contacts match your search. Try a different query.'
              : 'Click "Sync from Google" to import your contacts.'}
          </p>
        </div>
      )}

      {/* Contact List */}
      {!loadingContacts && contactsData && contactsData.contacts.length > 0 && (
        <>
          <div className="grid gap-3">
            {contactsData.contacts.map(contact => (
              <ContactCard
                key={contact.id}
                contact={contact}
                onClick={() => setSelectedContactId(contact.id)}
              />
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Showing {offset + 1}-{Math.min(offset + limit, contactsData.total)} of {contactsData.total}
            </p>
            <div className="flex gap-2">
              <button
                onClick={handlePrevPage}
                disabled={offset === 0}
                className={`px-4 py-2 rounded-lg border ${
                  offset === 0
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                Previous
              </button>
              <button
                onClick={handleNextPage}
                disabled={!contactsData.hasMore}
                className={`px-4 py-2 rounded-lg border ${
                  !contactsData.hasMore
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {/* Contact Details Modal */}
      {selectedContactId !== null && (
        <ContactDetailsModal
          contactId={selectedContactId}
          onClose={() => setSelectedContactId(null)}
        />
      )}
    </div>
  );
}
