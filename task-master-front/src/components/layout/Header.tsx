import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import './Header.css';

/** App header: name + account dropdown containing Logout (two-step, can't fire accidentally). */
export function Header() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const label = user?.displayName || user?.email || 'Account';
  const initial = label.charAt(0).toUpperCase();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <header className="header">
      <span className="header__brand">TaskMaster</span>
      <div className="header__account" ref={menuRef}>
        <button
          type="button"
          className="header__trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="header__avatar" aria-hidden="true">
            {initial}
          </span>
          <span className="header__name">{label}</span>
        </button>
        {open && (
          <div className="header__menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="header__menu-item"
              onClick={() => {
                setOpen(false);
                void logout();
              }}
            >
              Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
