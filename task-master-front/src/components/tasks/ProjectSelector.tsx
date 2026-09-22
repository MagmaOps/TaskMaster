import type { ProjectDTO } from '../../api/types';
import type { Selection } from '../../contexts/TaskContext';
import './ProjectSelector.css';

// Served from public/ at the site root; referenced by URL (not a bundled import).
const focusIcon = '/icons/focus.png';

interface ProjectSelectorProps {
  projects: ProjectDTO[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

function isActive(sel: Selection, target: Selection): boolean {
  if (sel.kind !== target.kind) return false;
  if (sel.kind === 'project' && target.kind === 'project') return sel.id === target.id;
  return true;
}

/**
 * Single-select pill row: [Focus] [All] [project…]. Focus shows only the top
 * task; it is mutually exclusive with All / a project ("All, but only the top").
 * Projects are already sorted by priorityOrder (Unassigned first) from the API.
 */
export function ProjectSelector({ projects, selection, onSelect }: ProjectSelectorProps) {
  const pill = (active: boolean, extra = '') =>
    `selector__pill${active ? ' selector__pill--active' : ''}${extra ? ` ${extra}` : ''}`;

  return (
    <div className="selector" role="group" aria-label="Filter tasks">
      <button
        type="button"
        className={pill(isActive(selection, { kind: 'focus' }), 'selector__pill--focus')}
        aria-pressed={isActive(selection, { kind: 'focus' })}
        aria-label="Focus — show only your top task"
        onClick={() => onSelect({ kind: 'focus' })}
      >
        <img src={focusIcon} alt="" className="selector__focus-icon" aria-hidden="true" />
        Focus
      </button>

      <button
        type="button"
        className={pill(isActive(selection, { kind: 'all' }))}
        aria-pressed={isActive(selection, { kind: 'all' })}
        onClick={() => onSelect({ kind: 'all' })}
      >
        All
      </button>

      {projects.map((p) => {
        const target: Selection = { kind: 'project', id: p.id };
        return (
          <button
            key={p.id}
            type="button"
            className={pill(isActive(selection, target))}
            aria-pressed={isActive(selection, target)}
            onClick={() => onSelect(target)}
          >
            {p.name}
          </button>
        );
      })}
    </div>
  );
}
