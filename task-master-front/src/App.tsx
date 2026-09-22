import { Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Placeholder from './pages/Placeholder';
import TaskList from './pages/TaskList';
import ProjectManagement from './pages/ProjectManagement';
import {
  ProtectedRoute,
  RedirectIfAuthed,
  CatchAllRedirect,
} from './components/layout/ProtectedRoute';

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAuthed>
            <Login />
          </RedirectIfAuthed>
        }
      />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<TaskList />} />
        <Route path="/projects" element={<ProjectManagement />} />
        <Route path="/profile" element={<Placeholder title="Profile" />} />
        <Route path="/settings" element={<Placeholder title="Settings" />} />
      </Route>
      <Route path="*" element={<CatchAllRedirect />} />
    </Routes>
  );
}
