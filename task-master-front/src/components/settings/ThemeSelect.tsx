import type { ThemePreference } from '../../api/types';
import './settings.css';

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

interface ThemeSelectProps {
  value: ThemePreference;
  onChange: (next: ThemePreference) => void;
  pending?: boolean;
}

/** Theme preference selector (light / dark / system). */
export function ThemeSelect({ value, onChange, pending = false }: ThemeSelectProps) {
  return (
    <div className="setting-row">
      <div className="setting-row__text">
        <span className="setting-row__label">Theme</span>
        <span className="setting-row__desc">Choose light, dark, or match your system.</span>
      </div>
      <select
        className="setting-select"
        aria-label="Theme"
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value as ThemePreference)}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
