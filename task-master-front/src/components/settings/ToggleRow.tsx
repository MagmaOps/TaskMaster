import { useId } from 'react';
import './settings.css';

interface ToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  pending?: boolean;
  disabled?: boolean;
}

/**
 * A labeled on/off switch row. Uses a real `role="switch"` button for keyboard
 * and screen-reader support. While a save is pending it is disabled to prevent
 * duplicate concurrent writes of the same key.
 */
export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  pending = false,
  disabled = false,
}: ToggleRowProps) {
  const descId = useId();
  const isDisabled = disabled || pending;

  return (
    <div className="setting-row">
      <div className="setting-row__text">
        <span className="setting-row__label">{label}</span>
        {description && (
          <span id={descId} className="setting-row__desc">
            {description}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-describedby={description ? descId : undefined}
        aria-busy={pending || undefined}
        disabled={isDisabled}
        className={checked ? 'switch switch--on' : 'switch'}
        onClick={() => !isDisabled && onChange(!checked)}
      >
        <span className="switch__thumb" aria-hidden="true" />
      </button>
    </div>
  );
}
