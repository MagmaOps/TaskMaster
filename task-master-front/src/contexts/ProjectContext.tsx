import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import * as projectsApi from '../api/projects';
import { normalizeError } from '../api/client';
import type { CreateProjectInput, ProjectDTO, UpdateProjectInput } from '../api/types';

export type ProjectStatus = 'idle' | 'loading' | 'ready' | 'error';

interface ProjectContextValue {
  projects: ProjectDTO[];
  status: ProjectStatus;
  error: string | null;
  loadProjects: () => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<ProjectDTO>;
  updateProject: (id: string, input: UpdateProjectInput) => Promise<ProjectDTO>;
  deleteProject: (id: string) => Promise<void>;
  reorderProjects: (orderedRealIds: string[]) => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [status, setStatus] = useState<ProjectStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const data = await projectsApi.listProjects();
      setProjects(data);
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setError(normalizeError(err).message);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  // create/update/delete re-fetch so priorityOrder + taskCount stay server-truthful.
  const createProject = useCallback(
    async (input: CreateProjectInput) => {
      const created = await projectsApi.createProject(input);
      await loadProjects();
      return created;
    },
    [loadProjects],
  );

  const updateProject = useCallback(
    async (id: string, input: UpdateProjectInput) => {
      const updated = await projectsApi.updateProject(id, input);
      await loadProjects();
      return updated;
    },
    [loadProjects],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      await projectsApi.deleteProject(id);
      await loadProjects();
    },
    [loadProjects],
  );

  // Reorder sets from the returned order for a smooth result; on failure re-fetch
  // to restore server truth and rethrow so the caller can revert its optimistic UI.
  const reorderProjects = useCallback(
    async (orderedRealIds: string[]) => {
      try {
        const next = await projectsApi.reorderProjects(orderedRealIds);
        setProjects(next);
      } catch (err) {
        await loadProjects();
        throw normalizeError(err);
      }
    },
    [loadProjects],
  );

  const value = useMemo<ProjectContextValue>(
    () => ({
      projects,
      status,
      error,
      loadProjects,
      createProject,
      updateProject,
      deleteProject,
      reorderProjects,
    }),
    [projects, status, error, loadProjects, createProject, updateProject, deleteProject, reorderProjects],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProjects(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error('useProjects must be used within a ProjectProvider');
  }
  return ctx;
}
