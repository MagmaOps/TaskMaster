import { useState } from 'react';
import { useProjects } from '../contexts/ProjectContext';
import { useTasks } from '../contexts/TaskContext';
import type { CreateProjectInput, ProjectDTO } from '../api/types';
import { Spinner } from '../components/common/Spinner';
import { Button } from '../components/common/Button';
import { DefaultProjectRow } from '../components/projects/ProjectRow';
import { ProjectList } from '../components/projects/ProjectList';
import { ProjectFormModal } from '../components/projects/ProjectFormModal';
import { DeleteProjectDialog } from '../components/projects/DeleteProjectDialog';
import './ProjectManagement.css';

const MAX_PROJECTS = 20;

type ModalState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; project: ProjectDTO }
  | { kind: 'delete'; project: ProjectDTO };

export default function ProjectManagement() {
  const {
    projects,
    status,
    error,
    loadProjects,
    createProject,
    updateProject,
    deleteProject,
    reorderProjects,
  } = useProjects();
  const { loadTasks } = useTasks();
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });

  // Project changes that alter how tasks display (a task's embedded project
  // name/color, or a delete that detaches a project) require reloading tasks so
  // the Tasks page isn't stale when the user returns to it.
  const reorderAndSyncTasks = async (orderedRealIds: string[]) => {
    await reorderProjects(orderedRealIds);
    await loadTasks();
  };

  const unassigned = projects.find((p) => p.isDefault) ?? null;
  const real = projects.filter((p) => !p.isDefault);
  const atLimit = real.length >= MAX_PROJECTS;

  const close = () => setModal({ kind: 'none' });

  return (
    <div className="projects">
      <header className="projects__header">
        <h1 className="projects__title">Projects</h1>
        <Button
          onClick={() => setModal({ kind: 'create' })}
          disabled={atLimit}
          title={atLimit ? `You've reached the maximum of ${MAX_PROJECTS} projects` : undefined}
        >
          New project
        </Button>
      </header>

      {atLimit && (
        <p className="projects__limit-hint">
          You’ve reached the maximum of {MAX_PROJECTS} projects.
        </p>
      )}

      {status === 'loading' && <Spinner fullscreen label="Loading projects" />}

      {status === 'error' && (
        <div className="projects__error" role="alert">
          <p>{error ?? 'Could not load your projects.'}</p>
          <Button onClick={() => void loadProjects()}>Try again</Button>
        </div>
      )}

      {status === 'ready' && (
        <div className="projects__list">
          {unassigned && <DefaultProjectRow project={unassigned} />}

          {real.length === 0 ? (
            <div className="projects__empty">
              <p className="projects__empty-title">No projects yet.</p>
              <p className="projects__empty-text">
                Group your tasks by area of life. Drag to prioritize once you have a few.
              </p>
              <Button onClick={() => setModal({ kind: 'create' })}>Create a project</Button>
            </div>
          ) : (
            <ProjectList
              projects={real}
              onReorder={reorderAndSyncTasks}
              onEdit={(project) => setModal({ kind: 'edit', project })}
              onDelete={(project) => setModal({ kind: 'delete', project })}
            />
          )}
        </div>
      )}

      {modal.kind === 'create' && (
        <ProjectFormModal
          onClose={close}
          onSubmit={async (input: CreateProjectInput) => {
            await createProject(input);
          }}
        />
      )}

      {modal.kind === 'edit' && (
        <ProjectFormModal
          project={modal.project}
          onClose={close}
          onSubmit={async (input) => {
            await updateProject(modal.project.id, input);
            await loadTasks(); // rename/recolor changes the task cards' project tags
          }}
        />
      )}

      {modal.kind === 'delete' && (
        <DeleteProjectDialog
          project={modal.project}
          onClose={close}
          onConfirm={async (id) => {
            await deleteProject(id);
            await loadTasks(); // detaching the project updates affected task cards
          }}
        />
      )}
    </div>
  );
}
