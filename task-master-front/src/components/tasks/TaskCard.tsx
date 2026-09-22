import type { TaskDTO } from '../../api/types';
import { formatDue, priorityLabel } from '../../utils/taskFormat';
import './TaskCard.css';

interface TaskCardProps {
  task: TaskDTO;
  variant?: 'top' | 'list';
  onSelect: (task: TaskDTO) => void;
}

/**
 * A single task. `variant="top"` is the prominent "What's Next?" card; `list`
 * is the compact row. No weight number is ever displayed (free-user rule).
 */
export function TaskCard({ task, variant = 'list', onSelect }: TaskCardProps) {
  const due = formatDue(task.dueDate, task.dueTime);
  const isTop = variant === 'top';

  return (
    <button
      type="button"
      className={isTop ? 'taskcard taskcard--top' : 'taskcard'}
      onClick={() => onSelect(task)}
    >
      {isTop && <span className="taskcard__whatsnext">What’s next?</span>}
      <span className="taskcard__subject">{task.subject}</span>

      <span className="taskcard__meta">
        <span className={`taskcard__priority taskcard__priority--${task.priority}`}>
          {priorityLabel(task.priority)}
        </span>
        {due && <span className="taskcard__due">{due}</span>}
        {task.isRepeatable && (
          <span className="taskcard__repeat" aria-label="Repeatable task" title="Repeatable">
            ↻
          </span>
        )}
      </span>

      {task.projects.length > 0 && (
        <span className="taskcard__projects">
          {task.projects.map((p) => (
            <span key={p.id} className="taskcard__project-tag">
              {p.name}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}
