import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type {
  CreateProjectInput,
  CreateTaskInput,
  Priority,
  ProjectDTO,
  RepeatPattern,
  TaskDTO,
} from '../../api/types';
import { ApiError } from '../../api/types';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { ProjectTagInput, type Chip } from './ProjectTagInput';
import { randomPaletteColor } from '../../utils/projectColor';
import { useProjects } from '../../contexts/ProjectContext';
import * as projectsApi from '../../api/projects';
import './TaskForm.css';

interface TaskFormProps {
  /** When provided, the form is in edit mode and pre-filled. */
  initialTask?: TaskDTO;
  projects: ProjectDTO[];
  submitLabel: string;
  onSubmit: (input: CreateTaskInput) => Promise<void>;
  onCancel: () => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Seed chips from a task's currently-assigned REAL projects (never the default). */
function seedChips(initialTask: TaskDTO | undefined, projects: ProjectDTO[]): Chip[] {
  if (!initialTask) return [];
  const defaultIds = new Set(projects.filter((p) => p.isDefault).map((p) => p.id));
  return initialTask.projects
    .filter((p) => !defaultIds.has(p.id))
    .map((p) => ({ kind: 'existing', id: p.id, name: p.name, color: p.color }) as Chip);
}

/**
 * Resolve chips to real project ids, creating pending projects first.
 * On a 409 (name already exists), reconcile by re-fetching and matching by name.
 */
async function resolveProjectIds(
  chips: Chip[],
  createProject: (input: CreateProjectInput) => Promise<ProjectDTO>,
  reloadProjects: () => Promise<ProjectDTO[]>,
): Promise<string[]> {
  const ids: string[] = [];
  for (const chip of chips) {
    if (chip.kind === 'existing') {
      ids.push(chip.id);
      continue;
    }
    try {
      const created = await createProject({ name: chip.name, color: randomPaletteColor() });
      ids.push(created.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        const latest = await reloadProjects();
        const match = latest.find(
          (p) => !p.isDefault && p.name.toLowerCase() === chip.name.toLowerCase(),
        );
        if (match) {
          ids.push(match.id);
          continue;
        }
      }
      throw err;
    }
  }
  return ids;
}

export function TaskForm({ initialTask, projects, submitLabel, onSubmit, onCancel }: TaskFormProps) {
  const { createProject } = useProjects();
  // Reconcile-by-name on 409 uses a direct fetch (returns the latest list).
  const reloadProjects = projectsApi.listProjects;
  const [subject, setSubject] = useState(initialTask?.subject ?? '');
  const [priority, setPriority] = useState<Priority>(initialTask?.priority ?? 'medium');
  const [showOptional, setShowOptional] = useState(false);
  const [dueDate, setDueDate] = useState(initialTask?.dueDate ?? '');
  const [dueTime, setDueTime] = useState(initialTask?.dueTime?.slice(0, 5) ?? '');
  // Project chips: existing (real ids, never the default) + pending (created on save).
  const initialChips = useMemo(() => seedChips(initialTask, projects), [initialTask, projects]);
  const [chips, setChips] = useState<Chip[]>(initialChips);
  const [isRepeatable, setIsRepeatable] = useState(initialTask?.isRepeatable ?? false);
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>(
    initialTask?.repeatPattern?.frequency ?? 'daily',
  );
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
    initialTask?.repeatPattern?.days_of_week ?? [],
  );

  const [subjectError, setSubjectError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const subjectRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    subjectRef.current?.focus();
  }, []);

  const toggleDay = (day: number) => {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const trimmed = subject.trim();
    if (trimmed.length < 1 || trimmed.length > 500) {
      setSubjectError('Subject is required (max 500 characters).');
      return;
    }
    setSubjectError(undefined);

    let repeatPattern: RepeatPattern | null = null;
    if (isRepeatable) {
      repeatPattern =
        frequency === 'weekly' ? { frequency, days_of_week: daysOfWeek } : { frequency };
    }

    setSubmitting(true);
    try {
      // Create any pending projects first, then submit the task with real ids.
      const projectIds = await resolveProjectIds(chips, createProject, reloadProjects);
      const input: CreateTaskInput = {
        subject: trimmed,
        priority,
        dueDate: dueDate || null,
        dueTime: dueDate && dueTime ? dueTime : null,
        projectIds,
        isRepeatable,
        repeatPattern,
      };
      await onSubmit(input);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
        setFormError(err.message);
      } else {
        setFormError(
          err instanceof Error ? err.message : 'Could not save the task. Please try again.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="taskform" onSubmit={handleSubmit} noValidate>
      <Input
        ref={subjectRef}
        label="What needs doing?"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        error={subjectError}
        maxLength={500}
      />

      <fieldset className="taskform__priority">
        <legend>Priority</legend>
        {(['high', 'medium', 'low'] as Priority[]).map((p) => (
          <label key={p} className="taskform__radio">
            <input
              type="radio"
              name="priority"
              value={p}
              checked={priority === p}
              onChange={() => setPriority(p)}
            />
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </label>
        ))}
      </fieldset>

      <button
        type="button"
        className="taskform__toggle-optional"
        aria-expanded={showOptional}
        onClick={() => setShowOptional((v) => !v)}
      >
        {showOptional ? 'Hide options' : 'More options'}
      </button>

      {showOptional && (
        <div className="taskform__optional">
          <Input
            label="Due date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <Input
            label="Due time"
            type="time"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
            disabled={!dueDate}
          />

          <ProjectTagInput projects={projects} value={chips} onChange={setChips} />

          <label className="taskform__check taskform__repeat-toggle">
            <input
              type="checkbox"
              checked={isRepeatable}
              onChange={(e) => setIsRepeatable(e.target.checked)}
            />
            Repeatable
          </label>

          {isRepeatable && (
            <div className="taskform__repeat">
              <label className="taskform__radio">
                <input
                  type="radio"
                  name="frequency"
                  checked={frequency === 'daily'}
                  onChange={() => setFrequency('daily')}
                />
                Daily
              </label>
              <label className="taskform__radio">
                <input
                  type="radio"
                  name="frequency"
                  checked={frequency === 'weekly'}
                  onChange={() => setFrequency('weekly')}
                />
                Weekly
              </label>

              {frequency === 'weekly' && (
                <fieldset className="taskform__days">
                  <legend>On days</legend>
                  {WEEKDAYS.map((label, day) => (
                    <label key={day} className="taskform__check">
                      <input
                        type="checkbox"
                        checked={daysOfWeek.includes(day)}
                        onChange={() => toggleDay(day)}
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
              )}
            </div>
          )}
        </div>
      )}

      {formError && (
        <p className="taskform__error" role="alert">
          {formError}
        </p>
      )}

      <div className="taskform__actions">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
