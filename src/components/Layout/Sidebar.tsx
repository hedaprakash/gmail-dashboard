import { NavLink } from 'react-router-dom';

interface SidebarProps {
  onClose?: () => void;
}

const navItems = [
  {
    section: 'Dashboard',
    items: [
      { path: '/', label: 'Review', icon: '📧' },
      { path: '/stats', label: 'Stats', icon: '📊' },
    ]
  },
  {
    section: 'Manage',
    items: [
      { path: '/criteria', label: 'Criteria', icon: '📋' },
      { path: '/execute', label: 'Execute', icon: '▶️' },
    ]
  }
];

export default function Sidebar({ onClose }: SidebarProps) {
  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      {/* Logo */}
      <div className="flex items-center h-16 px-4 border-b border-gray-200">
        <span className="text-xl font-bold text-primary">📧 Gmail Dashboard</span>
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto p-2 rounded-md hover:bg-gray-100 lg:hidden"
          >
            ✕
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-6 overflow-y-auto">
        {navItems.map(({ section, items }) => (
          <div key={section}>
            <h3 className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {section}
            </h3>
            <div className="mt-2 space-y-1">
              {items.map(({ path, label, icon }) => (
                <NavLink
                  key={path}
                  to={path}
                  onClick={onClose}
                  className={({ isActive }) => `
                    flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors
                    ${isActive
                      ? 'bg-blue-50 text-primary'
                      : 'text-gray-700 hover:bg-gray-100'
                    }
                  `}
                >
                  <span className="mr-3">{icon}</span>
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200 text-xs text-gray-500">
        Gmail Cleanup Dashboard v1.0
      </div>
    </div>
  );
}
