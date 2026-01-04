import { useMutation, useQueryClient } from '@tanstack/react-query';

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

  const refreshMutation = useMutation({
    mutationFn: refreshEmails,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    }
  });

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
    </header>
  );
}
