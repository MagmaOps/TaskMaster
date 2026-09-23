import type { ProjectAnalytics } from '../../api/types';
import type { AsyncState } from './profileFormat';
import { formatDay } from './profileFormat';
import { ProfileSection } from './ProfileSection';

/**
 * Per-project completion analytics: completed count, total completed weight
 * (a lifetime metric, not the hidden live task weight), and the last completion
 * day. Read-only, shown to all tiers.
 */
export function ProjectAnalyticsPanel({ state }: { state: AsyncState<ProjectAnalytics[]> }) {
  return (
    <ProfileSection title="Project activity" state={state}>
      {(rows) => {
        const hasCompletions = rows.some((r) => r.tasksCompleted > 0);
        if (!hasCompletions) {
          return (
            <p className="profile-section__empty">
              No completed tasks yet. Finish a few and your project activity shows up here.
            </p>
          );
        }
        return (
          <ul className="analytics__list" role="list">
            {rows.map((r) => {
              const last = formatDay(r.lastCompletionDate);
              return (
                <li key={r.projectId} className="analytics__row">
                  <span
                    className="analytics__swatch"
                    style={{ background: r.color ?? 'transparent' }}
                    aria-hidden="true"
                  />
                  <span className="analytics__name">{r.name}</span>
                  <span className="analytics__meta">
                    {r.tasksCompleted} done · {r.weightCompleted.toLocaleString()} lifetime weight
                    {last ? ` · last ${last}` : ' · no completions yet'}
                  </span>
                </li>
              );
            })}
          </ul>
        );
      }}
    </ProfileSection>
  );
}
