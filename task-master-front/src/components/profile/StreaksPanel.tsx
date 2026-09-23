import type { UserStreaks } from '../../api/types';
import type { AsyncState } from './profileFormat';
import { ProfileSection } from './ProfileSection';

/** Daily streak counters plus any per-repeatable-series streaks. Read-only. */
export function StreaksPanel({ state }: { state: AsyncState<UserStreaks> }) {
  return (
    <ProfileSection title="Streaks" state={state}>
      {(data) => {
        const current = data.daily?.current ?? 0;
        const longest = data.daily?.longest ?? 0;
        return (
          <div>
            <div className="streaks__row">
              <div className="streaks__stat">
                <span className="streaks__value">{current}</span>
                <span className="streaks__label">Current daily streak</span>
              </div>
              <div className="streaks__stat">
                <span className="streaks__value">{longest}</span>
                <span className="streaks__label">Longest daily streak</span>
              </div>
            </div>
            {data.series.length > 0 && (
              <ul className="streaks__series">
                {data.series.map((s) => (
                  <li key={s.seriesId} className="streaks__series-item">
                    <span>{s.label || 'Repeatable task'}</span>
                    <span className="streaks__label">
                      {s.current} current · {s.longest} best
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      }}
    </ProfileSection>
  );
}
