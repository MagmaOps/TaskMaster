import { Outlet } from 'react-router-dom';
import { TaskProvider } from '../../contexts/TaskContext';
import { ProjectProvider } from '../../contexts/ProjectContext';
import { useSettingsSync } from '../../hooks/useSettingsSync';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { Toast } from './Toast';
import './AppShell.css';

/**
 * Runs the authenticated settings bridge (adopts the server theme). Renders
 * nothing; mounted inside the auth gate so it only runs for signed-in users.
 */
function SettingsSync() {
  useSettingsSync();
  return null;
}

/**
 * Persistent authenticated shell: header, routed content, bottom nav, toasts.
 * Task/Project providers are mounted here (not above the auth gate) so data
 * loads only for authenticated users.
 */
export function AppShell() {
  return (
    <ProjectProvider>
      <TaskProvider>
        <SettingsSync />
        <div className="app-shell">
          <Header />
          <main className="app-shell__main">
            <Outlet />
          </main>
          <BottomNav />
          <Toast />
        </div>
      </TaskProvider>
    </ProjectProvider>
  );
}
