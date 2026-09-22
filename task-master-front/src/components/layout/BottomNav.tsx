import { NavLink } from 'react-router-dom';
import './BottomNav.css';

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

// Order matters: Tasks, Projects, [center Add], Profile, Settings.
const LEFT_ITEMS: NavItem[] = [
  { to: '/', label: 'Tasks', icon: '☰' },
  { to: '/projects', label: 'Projects', icon: '▦' },
];
const RIGHT_ITEMS: NavItem[] = [
  { to: '/profile', label: 'Profile', icon: '☆' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

function NavButton({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) => (isActive ? 'bottomnav__link bottomnav__link--active' : 'bottomnav__link')}
      aria-label={item.label}
    >
      <span className="bottomnav__icon" aria-hidden="true">
        {item.icon}
      </span>
      <span className="bottomnav__label">{item.label}</span>
    </NavLink>
  );
}

export function BottomNav() {
  return (
    <nav className="bottomnav" aria-label="Primary">
      {LEFT_ITEMS.map((item) => (
        <NavButton key={item.to} item={item} />
      ))}

      {/* Center Add (+). Wiring to the Quick-Add modal is a later spec. */}
      <button
        type="button"
        className="bottomnav__add"
        aria-label="Add task"
        title="Add task (coming soon)"
        disabled
      >
        +
      </button>

      {RIGHT_ITEMS.map((item) => (
        <NavButton key={item.to} item={item} />
      ))}
    </nav>
  );
}
