import { useState } from 'react';
import type { DeferOption } from '../../api/types';
import { Button } from '../common/Button';
import './DeferralModal.css';

interface DeferralModalProps {
  onDefer: (option: DeferOption) => Promise<void>;
  onBack: () => void;
}

const OPTIONS: { option: DeferOption; label: string; hint: string }[] = [
  { option: 'later_today', label: 'Later today', hint: 'Nudge it to the end of today.' },
  { option: 'tomorrow', label: 'Tomorrow', hint: 'Come back to it fresh tomorrow.' },
  {
    option: 'sometime_later',
    label: 'Sometime later',
    hint: 'Ease off — lowers priority and clears the due date.',
  },
];

/** The three guilt-free "Later" options. Friendly, non-judgmental copy. */
export function DeferralModal({ onDefer, onBack }: DeferralModalProps) {
  const [pending, setPending] = useState<DeferOption | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (option: DeferOption) => {
    setError(null);
    setPending(option);
    try {
      await onDefer(option);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not defer. Please try again.');
      setPending(null);
    }
  };

  return (
    <div className="deferral">
      <p className="deferral__intro">No guilt — when do you want to see it again?</p>
      <ul className="deferral__list">
        {OPTIONS.map((o) => (
          <li key={o.option}>
            <button
              type="button"
              className="deferral__option"
              onClick={() => choose(o.option)}
              disabled={pending !== null}
              aria-busy={pending === o.option}
            >
              <span className="deferral__option-label">{o.label}</span>
              <span className="deferral__option-hint">{o.hint}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="deferral__error" role="alert">
          {error}
        </p>
      )}
      <Button variant="ghost" onClick={onBack} disabled={pending !== null}>
        Back
      </Button>
    </div>
  );
}
