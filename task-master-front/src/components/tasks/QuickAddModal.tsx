import type { CreateTaskInput, ProjectDTO } from '../../api/types';
import { Modal } from '../common/Modal';
import { TaskForm } from './TaskForm';

interface QuickAddModalProps {
  open: boolean;
  projects: ProjectDTO[];
  onClose: () => void;
  onCreate: (input: CreateTaskInput) => Promise<void>;
}

/** Fast task capture opened by the bottom-nav + button or the empty-state CTA. */
export function QuickAddModal({ open, projects, onClose, onCreate }: QuickAddModalProps) {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title="Add a task">
      <TaskForm
        projects={projects}
        submitLabel="Add task"
        onSubmit={async (input) => {
          await onCreate(input);
          onClose();
        }}
        onCancel={onClose}
      />
    </Modal>
  );
}
