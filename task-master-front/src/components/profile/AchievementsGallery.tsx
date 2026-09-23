import type { AchievementRow } from '../../api/types';
import { ACHIEVEMENT_CATALOG, achievementMeta } from '../../utils/achievementCatalog';
import type { AsyncState } from './profileFormat';
import { formatTimestamp } from './profileFormat';
import { ProfileSection } from './ProfileSection';

/**
 * Achievements grid. Renders every defined achievement: unlocked ones (with
 * title, description, and unlock date) and greyed locked ones (no date). An
 * unlocked type not in the catalog (future backend addition) is appended with a
 * humanized-slug title so the page never errors.
 */
export function AchievementsGallery({ state }: { state: AsyncState<AchievementRow[]> }) {
  return (
    <ProfileSection title="Achievements" state={state}>
      {(rows) => {
        // First unlock per type (rows are newest-first from the API).
        const unlockedByType = new Map<string, AchievementRow>();
        for (const row of rows) {
          if (!unlockedByType.has(row.type)) unlockedByType.set(row.type, row);
        }

        const catalogTypes = new Set(ACHIEVEMENT_CATALOG.map((m) => m.type));
        const extraUnlocked = [...unlockedByType.keys()].filter((t) => !catalogTypes.has(t));

        const items = [
          ...ACHIEVEMENT_CATALOG.map((m) => ({ meta: m, row: unlockedByType.get(m.type) ?? null })),
          ...extraUnlocked.map((t) => ({ meta: achievementMeta(t), row: unlockedByType.get(t)! })),
        ];

        const anyUnlocked = unlockedByType.size > 0;

        return (
          <div>
            {!anyUnlocked && (
              <p className="profile-section__empty">
                No achievements yet — complete a task to unlock your first one.
              </p>
            )}
            <ul className="achievements__grid" role="list">
              {items.map(({ meta, row }) => {
                const unlocked = row !== null;
                return (
                  <li
                    key={meta.type}
                    className={unlocked ? 'achievement' : 'achievement achievement--locked'}
                    aria-label={
                      unlocked
                        ? `${meta.title}. Unlocked on ${formatTimestamp(row!.unlocked_at)}.`
                        : `${meta.title}. Locked.`
                    }
                  >
                    <p className="achievement__title">{meta.title}</p>
                    {meta.description && <p className="achievement__desc">{meta.description}</p>}
                    {unlocked && (
                      <p className="achievement__date">
                        Unlocked {formatTimestamp(row!.unlocked_at)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      }}
    </ProfileSection>
  );
}
