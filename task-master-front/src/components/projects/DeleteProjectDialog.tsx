import { useState } from 'react';
import type { ProjectDTO } from '../../api/types';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import './DeleteProjectDialog.css';

interface DeleteProjectDialogProps {
  project: ProjectDTO;
  onClose: () => void;
  onConfirm: (id: string) => Promise<void>;
}

export function DeleteProjectDialog({ project, onClose, onConfirm }: DeleteProjectDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setError(null);
    setBusy(true);
    try {
      await onConfirm(project.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the project.');
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Delete project">
      <p className="deleteproject__text">
        Delete “{project.name}”? Your tasks are kept — they simply move back to Unassigned. Only the
        grouping is removed.
      </p>
      {error && (
        <p className="deleteproject__error" role="alert">
          {error}
        </p>
      )}
      <div className="deleteproject__actions">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="danger" onClick={handleDelete} loading={busy}>
          Delete project
        </Button>
      </div>
    </Modal>
  );
}
