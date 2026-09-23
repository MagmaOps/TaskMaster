import { Button } from '../common/Button';
import { detectTimezone, timezoneOptions } from '../../utils/timezones';
import './settings.css';

interface TimezoneSelectProps {
  value: string;
  onChange: (next: string) => void;
  pending?: boolean;
}

/**
 * Timezone picker: a native <select> over a curated list of common IANA zones
 * (the current value is always selectable, prepended if not in the list), plus
 * a one-tap "use my detected timezone" button. Deliberately simple — no
 * searchable long-list. The backend validates the chosen zone.
 */
export function TimezoneSelect({ value, onChange, pending = false }: TimezoneSelectProps) {
  const options = timezoneOptions(value);
  const detected = detectTimezone();

  return (
    <div className="setting-row setting-row--stacked">
      <div className="setting-row__text">
        <span className="setting-row__label">Timezone</span>
        <span className="setting-row__desc">Used for streaks and due dates.</span>
      </div>
      <div className="setting-row__control-group">
        <select
          className="setting-select"
          aria-label="Timezone"
          value={value}
          disabled={pending}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
        {detected && detected !== value && (
          <Button variant="ghost" disabled={pending} onClick={() => onChange(detected)}>
            Use {detected}
          </Button>
        )}
      </div>
    </div>
  );
}
