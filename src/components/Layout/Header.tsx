import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';

interface HeaderProps {
  onMenuClick: () => void;
}

async function refreshEmails() {
  const res = await fetch('/api/emails/refresh', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to refresh');
  return res.json();
}

export default function Header({ onMenuClick }: HeaderProps) {
  const queryClient = useQueryClient();
  const { email, logout, isAuthenticated } = useAuth();

  const refreshMutation = useMutation({
    mutationFn: refreshEmails,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    }
  });

  const handleLogout = async () => {
    await logout();
    window.location.href = '/login';
  };

  return (
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
            <span className="animate-spin">⟳</span>
            Refreshing...
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
  );
}
