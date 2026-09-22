import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { Toast } from './Toast';
import './AppShell.css';

/** Persistent authenticated shell: header, routed content, bottom nav, toasts. */
export function AppShell() {
  return (
    <div className="app-shell">
      <Header />
      <main className="app-shell__main">
        <Outlet />
      </main>
      <BottomNav />
      <Toast />
    </div>
  );
}
