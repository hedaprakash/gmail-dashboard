import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';

interface HeaderProps {
  onMenuClick: () => void;
}

interface RefreshResult {
  totalEmails?: number;
  cacheFile?: string;
}

async function refreshEmails(): Promise<RefreshResult> {
  const res = await fetch('/api/emails/refresh', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to refresh');
  return res.json();
}

export default function Header({ onMenuClick }: HeaderProps) {
  const queryClient = useQueryClient();
  const { email, logout, isAuthenticated } = useAuth();
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  const refreshMutation = useMutation({
    mutationFn: refreshEmails,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      showNotification('success', `Refreshed! Found ${data.totalEmails || 'N/A'} emails.`);
    },
    onError: (error) => {
      showNotification('error', `Refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  const handleLogout = async () => {
    await logout();
    window.location.href = '/login';
  };

  return (
    <>
      {/* Notification Toast */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-pulse ${
          notification.type === 'success'
            ? 'bg-green-100 text-green-800 border border-green-200'
            : 'bg-red-100 text-red-800 border border-red-200'
        }`}>
          {notification.type === 'success' ? '✓' : '✕'}
          {notification.message}
          <button
            onClick={() => setNotification(null)}
            className="ml-2 text-gray-500 hover:text-gray-700"
          >
            ×
          </button>
        </div>
      )}

      <header className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b bg-white px-4 shadow-sm">
        {/* Menu button - mobile */}
        <button
          onClick={onMenuClick}
          className="p-2 rounded-md hover:bg-gray-100 lg:hidden"
        >
          ☰
        </button>

      {/* Title */}
      <h1 className="text-lg font-semibold text-gray-800 lg:hidden">
        Gmail Dashboard
      </h1>

      {/* Spacer */}
      <div className="flex-1" />

      {/* User info */}
      {isAuthenticated && email && (
        <div className="hidden sm:flex items-center gap-2 text-sm text-gray-600">
          <span className="inline-block w-2 h-2 bg-green-500 rounded-full"></span>
          <span className="max-w-[200px] truncate">{email}</span>
        </div>
      )}

      {/* Refresh button */}
      <button
        onClick={() => refreshMutation.mutate()}
        disabled={refreshMutation.isPending}
        className={`
          flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm
          ${refreshMutation.isPending
            ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
            : 'bg-blue-500 text-white hover:bg-blue-600'
          }
        `}
      >
        {refreshMutation.isPending ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Refreshing... (this may take a minute)
          </>
        ) : (
          <>
            🔄 Refresh from Gmail
          </>
        )}
      </button>

      {/* Logout button */}
      {isAuthenticated && (
        <button
          onClick={handleLogout}
          className="flex items-center gap-1 px-3 py-2 rounded-md text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          title="Logout"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          <span className="hidden sm:inline">Logout</span>
        </button>
      )}
      </header>
    </>
  );
}
