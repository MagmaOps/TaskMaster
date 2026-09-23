import { Modal } from '../common/Modal';
import type { TaskDTO } from '../../api/types';
import './WeightBreakdownModal.css';

interface WeightBreakdownModalProps {
  task: TaskDTO;
  open: boolean;
  onClose: () => void;
}

const LINES: { key: keyof NonNullable<TaskDTO['weightBreakdown']>; label: string }[] = [
  { key: 'base', label: 'Base (age + priority)' },
  { key: 'dueProximity', label: 'Due date proximity' },
  { key: 'project', label: 'Project priority' },
  { key: 'deferral', label: 'Deferrals' },
  { key: 'repeatable', label: 'Repeatable boost' },
];

/**
 * Premium-only popup that explains how a task's weight is composed, using the
 * `weightBreakdown` already present on the task (no extra fetch). Opened from
 * the info icon on the task card.
 */
export function WeightBreakdownModal({ task, open, onClose }: WeightBreakdownModalProps) {
  const b = task.weightBreakdown;
  return (
    <Modal open={open} onClose={onClose} title="Weight breakdown">
      {b ? (
        <table className="weight-breakdown">
          <tbody>
            {LINES.map((line) => (
              <tr key={line.key}>
                <th scope="row">{line.label}</th>
                <td>{b[line.key]}</td>
              </tr>
            ))}
            <tr className="weight-breakdown__total">
              <th scope="row">Total</th>
              <td>{b.total}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p>This task's weight is {task.weight}. A detailed breakdown isn't available.</p>
      )}
    </Modal>
  );
}
