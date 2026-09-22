import { useToast } from '../../contexts/ToastContext';
import './Toast.css';

/**
 * Global toast overlay. Minimal for this spec (transient messages); the
 * profile/achievements spec will extend it with celebration variants.
 */
export function Toast() {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className="toast"
          onClick={() => dismissToast(t.id)}
          aria-label={`Dismiss: ${t.message}`}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
