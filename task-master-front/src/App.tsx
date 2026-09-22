import { Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Placeholder from './pages/Placeholder';
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
        <Route path="/" element={<Placeholder title="Tasks" />} />
        <Route path="/projects" element={<Placeholder title="Projects" />} />
        <Route path="/profile" element={<Placeholder title="Profile" />} />
        <Route path="/settings" element={<Placeholder title="Settings" />} />
      </Route>
      <Route path="*" element={<CatchAllRedirect />} />
    </Routes>
  );
}
