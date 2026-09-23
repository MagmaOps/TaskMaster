import { Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import TaskList from './pages/TaskList';
import ProjectManagement from './pages/ProjectManagement';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
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
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<CatchAllRedirect />} />
    </Routes>
  );
}
