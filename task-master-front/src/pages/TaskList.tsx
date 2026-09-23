import { useEffect, useRef, useState } from 'react';
import { useTasks } from '../contexts/TaskContext';
import { useProjects } from '../contexts/ProjectContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import type { CompleteTaskData, TaskDTO } from '../api/types';
import { celebrationMessage } from '../utils/achievementCopy';
import { Spinner } from '../components/common/Spinner';
import { Button } from '../components/common/Button';
import { ProjectSelector } from '../components/tasks/ProjectSelector';
import { TaskCard } from '../components/tasks/TaskCard';
import { QuickAddModal } from '../components/tasks/QuickAddModal';
import { ActionModal } from '../components/tasks/ActionModal';
import './TaskList.css';

export default function TaskList() {
  const {
    tasks,
    status,
    error,
    selection,
    setSelection,
    loadTasks,
    createTask,
    updateTask,
    completeTask,
    deferTask,
    archiveTask,
    isQuickAddOpen,
    openQuickAdd,
    closeQuickAdd,
  } = useTasks();
  const { user } = useAuth();
  const { showToast } = useToast();

  // Focus Mode is a *default* view: on first mount, seed the selection to focus
  // when the setting is on. The user can still switch views via the selector
  // pills afterward, so this applies only once per mount.
  const appliedFocusDefault = useRef(false);
  useEffect(() => {
    if (appliedFocusDefault.current) return;
    appliedFocusDefault.current = true;
    if (user?.settings.focus_mode_enabled) {
      setSelection({ kind: 'focus' });
    }
  }, [user?.settings.focus_mode_enabled, setSelection]);
  // Single source of truth for projects: the context list is refreshed when a
  // project is created (incl. inline creation from the task form), so the
  // selector and the tag-input suggestions update immediately.
  const { projects } = useProjects();

  const [selectedTask, setSelectedTask] = useState<TaskDTO | null>(null);

  const celebrate = (result: CompleteTaskData) => {
    if (user?.settings.achievement_toasts_enabled === false) return;
    result.unlocked.forEach((a) => showToast(celebrationMessage(a)));
  };

  const focusMode = selection.kind === 'focus';
  const topTask = tasks[0];
  const restTasks = tasks.slice(1);
  const showWeight = user?.tier === 'premium' && user.settings.weight_visibility_enabled === true;

  return (
    <div className="tasklist">
      <ProjectSelector projects={projects} selection={selection} onSelect={setSelection} />

      {status === 'loading' && <Spinner fullscreen label="Loading tasks" />}

      {status === 'error' && (
        <div className="tasklist__error" role="alert">
          <p>{error ?? 'Could not load your tasks.'}</p>
          <Button onClick={() => void loadTasks()}>Try again</Button>
        </div>
      )}

      {status === 'ready' && tasks.length === 0 && (
        <div className="tasklist__empty">
          <p className="tasklist__empty-title">Nothing here yet.</p>
          <p className="tasklist__empty-text">Add your first task and TaskMaster takes it from here.</p>
          <Button onClick={openQuickAdd}>Add your first task</Button>
        </div>
      )}

      {status === 'ready' && tasks.length > 0 && (
        <div className="tasklist__content">
          {topTask && (
            <TaskCard
              task={topTask}
              variant="top"
              onSelect={setSelectedTask}
              showWeight={showWeight}
            />
          )}
          {!focusMode &&
            restTasks.map((t) => (
              <TaskCard key={t.id} task={t} onSelect={setSelectedTask} showWeight={showWeight} />
            ))}
        </div>
      )}

      <QuickAddModal
        open={isQuickAddOpen}
        projects={projects}
        onClose={closeQuickAdd}
        onCreate={async (input) => {
          await createTask(input);
        }}
      />

      {selectedTask && (
        <ActionModal
          task={selectedTask}
          projects={projects}
          onClose={() => setSelectedTask(null)}
          onComplete={completeTask}
          onDefer={async (id, option) => {
            await deferTask(id, option);
          }}
          onUpdate={async (id, input) => {
            await updateTask(id, input);
          }}
          onArchive={async (id) => {
            await archiveTask(id);
          }}
          onCelebrate={celebrate}
        />
      )}
    </div>
  );
}
