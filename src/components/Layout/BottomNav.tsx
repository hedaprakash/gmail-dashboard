import { NavLink } from 'react-router-dom';

const navItems = [
  { path: '/', label: 'Review', icon: '📧' },
  { path: '/stats', label: 'Stats', icon: '📊' },
  { path: '/criteria', label: 'Criteria', icon: '📋' },
  { path: '/execute', label: 'Execute', icon: '▶️' },
];

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 lg:hidden">
      <div className="flex justify-around">
        {navItems.map(({ path, label, icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) => `
              flex flex-col items-center py-2 px-4 text-xs font-medium
              ${isActive ? 'text-primary' : 'text-gray-600'}
            `}
          >
            <span className="text-xl mb-1">{icon}</span>
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
