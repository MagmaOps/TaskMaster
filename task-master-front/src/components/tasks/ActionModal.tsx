import { useState } from 'react';
import type {
  CompleteTaskData,
  DeferOption,
  ProjectDTO,
  TaskDTO,
  UpdateTaskInput,
} from '../../api/types';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { TaskForm } from './TaskForm';
import { DeferralModal } from './DeferralModal';
import './ActionModal.css';

interface ActionModalProps {
  task: TaskDTO;
  projects: ProjectDTO[];
  onClose: () => void;
  onComplete: (id: string) => Promise<CompleteTaskData>;
  onDefer: (id: string, option: DeferOption) => Promise<void>;
  onUpdate: (id: string, input: UpdateTaskInput) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
  /** Fire celebration toasts for any unlocked achievements. */
  onCelebrate: (result: CompleteTaskData) => void;
}

type View = 'actions' | 'defer' | 'modify' | 'confirm-delete';

export function ActionModal({
  task,
  projects,
  onClose,
  onComplete,
  onDefer,
  onUpdate,
  onArchive,
  onCelebrate,
}: ActionModalProps) {
  const [view, setView] = useState<View>('actions');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  const handleComplete = () =>
    run(async () => {
      const result = await onComplete(task.id);
      onCelebrate(result);
      onClose();
    });

  const handleArchive = () =>
    run(async () => {
      await onArchive(task.id);
      onClose();
    });

  const title =
    view === 'modify' ? 'Edit task' : view === 'defer' ? 'Later' : task.subject;

  return (
    <Modal open onClose={onClose} title={title}>
      {view === 'actions' && (
        <div className="actionmodal">
          <Button fullWidth onClick={handleComplete} loading={busy}>
            Complete
          </Button>
          <Button fullWidth variant="secondary" onClick={() => setView('defer')} disabled={busy}>
            Later
          </Button>
          <Button fullWidth variant="secondary" onClick={() => setView('modify')} disabled={busy}>
            Modify
          </Button>
          <Button fullWidth variant="ghost" onClick={handleArchive} disabled={busy}>
            Archive
          </Button>
          <Button
            fullWidth
            variant="danger"
            onClick={() => setView('confirm-delete')}
            disabled={busy}
          >
            Delete
          </Button>
          {error && (
            <p className="actionmodal__error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      {view === 'defer' && (
        <DeferralModal
          onBack={() => setView('actions')}
          onDefer={async (option) => {
            await onDefer(task.id, option);
            onClose();
          }}
        />
      )}

      {view === 'modify' && (
        <TaskForm
          initialTask={task}
          projects={projects}
          submitLabel="Save changes"
          onCancel={() => setView('actions')}
          onSubmit={async (input) => {
            await onUpdate(task.id, input);
            onClose();
          }}
        />
      )}

      {view === 'confirm-delete' && (
        <div className="actionmodal">
          <p className="actionmodal__confirm">
            Delete “{task.subject}”? This removes it from your list.
          </p>
          <Button fullWidth variant="danger" onClick={handleArchive} loading={busy}>
            Yes, delete
          </Button>
          <Button fullWidth variant="ghost" onClick={() => setView('actions')} disabled={busy}>
            Cancel
          </Button>
          {error && (
            <p className="actionmodal__error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
