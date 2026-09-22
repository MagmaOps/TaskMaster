import { Outlet } from 'react-router-dom';
import { TaskProvider } from '../../contexts/TaskContext';
import { ProjectProvider } from '../../contexts/ProjectContext';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { Toast } from './Toast';
import './AppShell.css';

/**
 * Persistent authenticated shell: header, routed content, bottom nav, toasts.
 * Task/Project providers are mounted here (not above the auth gate) so data
 * loads only for authenticated users.
 */
export function AppShell() {
  return (
    <ProjectProvider>
      <TaskProvider>
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
