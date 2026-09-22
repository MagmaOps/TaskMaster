import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTasks } from '../../contexts/TaskContext';
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
  const { openQuickAdd } = useTasks();
  const navigate = useNavigate();
  const location = useLocation();

  const handleAdd = () => {
    // Quick-Add lives on the Tasks page; go there first if elsewhere, then open.
    if (location.pathname !== '/') navigate('/');
    openQuickAdd();
  };

  return (
    <nav className="bottomnav" aria-label="Primary">
      {LEFT_ITEMS.map((item) => (
        <NavButton key={item.to} item={item} />
      ))}

      <button type="button" className="bottomnav__add" aria-label="Add task" onClick={handleAdd}>
        +
      </button>

      {RIGHT_ITEMS.map((item) => (
        <NavButton key={item.to} item={item} />
      ))}
    </nav>
  );
}
