import './Spinner.css';

interface SpinnerProps {
  label?: string;
  /** Center in a full-height container (used for the app bootstrap screen). */
  fullscreen?: boolean;
}

export function Spinner({ label = 'Loading', fullscreen = false }: SpinnerProps) {
  return (
    <div
      className={fullscreen ? 'spinner-wrap spinner-wrap--full' : 'spinner-wrap'}
      role="status"
      aria-live="polite"
    >
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
