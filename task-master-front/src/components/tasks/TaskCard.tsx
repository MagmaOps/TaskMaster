import { useState } from 'react';
import type { TaskDTO } from '../../api/types';
import { formatDue, priorityLabel } from '../../utils/taskFormat';
import { WeightBreakdownModal } from './WeightBreakdownModal';
import './TaskCard.css';

interface TaskCardProps {
  task: TaskDTO;
  variant?: 'top' | 'list';
  onSelect: (task: TaskDTO) => void;
  /** Premium + weight-visibility on: show the weight number + breakdown info icon. */
  showWeight?: boolean;
}

/**
 * A single task. `variant="top"` is the prominent "What's Next?" card; `list`
 * is the compact row. The weight number is hidden by default (free-user rule)
 * and only shown when `showWeight` (premium + setting enabled), alongside an
 * info icon that opens the weight breakdown.
 */
export function TaskCard({ task, variant = 'list', onSelect, showWeight = false }: TaskCardProps) {
  const due = formatDue(task.dueDate, task.dueTime);
  const isTop = variant === 'top';
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  return (
    <div className={isTop ? 'taskcard-wrap taskcard-wrap--top' : 'taskcard-wrap'}>
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

      {showWeight && (
        <div className="taskcard__weight">
          <span className="taskcard__weight-value">{task.weight}</span>
          <button
            type="button"
            className="taskcard__weight-info"
            aria-label="Show weight breakdown"
            onClick={(e) => {
              e.stopPropagation();
              setBreakdownOpen(true);
            }}
          >
            ⓘ
          </button>
        </div>
      )}

      {showWeight && (
        <WeightBreakdownModal
          task={task}
          open={breakdownOpen}
          onClose={() => setBreakdownOpen(false)}
        />
      )}
    </div>
  );
}
