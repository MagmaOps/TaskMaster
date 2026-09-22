import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CreateProjectInput, ProjectDTO } from '../../api/types';
import { ApiError } from '../../api/types';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { PALETTE } from '../../utils/projectColor';
import './ProjectFormModal.css';

interface ProjectFormModalProps {
  /** When provided, the form edits this project; otherwise it creates. */
  project?: ProjectDTO;
  onClose: () => void;
  onSubmit: (input: CreateProjectInput) => Promise<void>;
}

function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'CONFLICT':
        return 'A project with that name already exists.';
      case 'VALIDATION_ERROR':
        return err.message || 'Please check the details and try again.';
      case 'NETWORK':
        return 'Unable to reach the server. Check your connection and try again.';
      default:
        return 'Could not save the project. Please try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}

export function ProjectFormModal({ project, onClose, onSubmit }: ProjectFormModalProps) {
  const isEdit = Boolean(project);
  const [name, setName] = useState(project?.name ?? '');
  const [color, setColor] = useState<string | null>(project?.color ?? null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 255) {
      setNameError('Name is required (max 255 characters).');
      return;
    }
    setNameError(undefined);

    setSubmitting(true);
    try {
      await onSubmit({ name: trimmed, color });
      onClose();
    } catch (err) {
      setFormError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Edit project' : 'New project'}>
      <form onSubmit={handleSubmit} noValidate>
        <Input
          ref={nameRef}
          label="Project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={nameError}
          maxLength={255}
        />

        <fieldset className="projectform__colors">
          <legend>Color</legend>
          <div className="projectform__swatches">
            <button
              type="button"
              className={`projectform__swatch projectform__swatch--none${color === null ? ' projectform__swatch--active' : ''}`}
              onClick={() => setColor(null)}
              aria-label="No color"
              aria-pressed={color === null}
            >
              ⦸
            </button>
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className={`projectform__swatch${color === c ? ' projectform__swatch--active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                aria-pressed={color === c}
              />
            ))}
          </div>
        </fieldset>

        {formError && (
          <p className="projectform__error" role="alert">
            {formError}
          </p>
        )}

        <div className="projectform__actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {isEdit ? 'Save changes' : 'Create project'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
