import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ProjectDTO } from '../../api/types';
import './ProjectRow.css';

interface ProjectRowProps {
  project: ProjectDTO;
  onEdit?: (project: ProjectDTO) => void;
  onDelete?: (project: ProjectDTO) => void;
}

function Swatch({ color }: { color: string | null }) {
  return (
    <span
      className="projectrow__swatch"
      style={color ? { background: color } : undefined}
      data-empty={color ? undefined : 'true'}
      aria-hidden="true"
    />
  );
}

function CountAndActions({
  project,
  onEdit,
  onDelete,
}: Required<Pick<ProjectRowProps, 'project'>> & Pick<ProjectRowProps, 'onEdit' | 'onDelete'>) {
  return (
    <span className="projectrow__right">
      <span className="projectrow__count">{project.taskCount}</span>
      {onEdit && (
        <button
          type="button"
          className="projectrow__action"
          aria-label={`Edit ${project.name}`}
          onClick={() => onEdit(project)}
        >
          Edit
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          className="projectrow__action projectrow__action--danger"
          aria-label={`Delete ${project.name}`}
          onClick={() => onDelete(project)}
        >
          Delete
        </button>
      )}
    </span>
  );
}

/** The pinned, non-draggable Unassigned (default) row — no handle, no actions. */
export function DefaultProjectRow({ project }: { project: ProjectDTO }) {
  return (
    <div className="projectrow projectrow--default">
      <span className="projectrow__handle-spacer" aria-hidden="true" />
      <Swatch color={project.color} />
      <span className="projectrow__name">
        {project.name}
        <span className="projectrow__badge">Default</span>
      </span>
      <span className="projectrow__right">
        <span className="projectrow__count">{project.taskCount}</span>
      </span>
    </div>
  );
}

/** A sortable real-project row with a drag handle and edit/delete actions. */
export function ProjectRow({ project, onEdit, onDelete }: ProjectRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="projectrow">
      <button
        type="button"
        className="projectrow__handle"
        aria-label={`Reorder ${project.name}`}
        {...attributes}
        {...listeners}
      >
        ☰
      </button>
      <Swatch color={project.color} />
      <span className="projectrow__name">{project.name}</span>
      <CountAndActions project={project} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}
