import { useCallback, useEffect, useState } from 'react';
import * as profileApi from '../api/profile';
import { normalizeError } from '../api/client';
import type { AchievementRow, Economy, ProjectAnalytics, UserStreaks } from '../api/types';
import type { AsyncState } from '../components/profile/profileFormat';
import { StreaksPanel } from '../components/profile/StreaksPanel';
import { EconomyPanel } from '../components/profile/EconomyPanel';
import { AchievementsGallery } from '../components/profile/AchievementsGallery';
import { ProjectAnalyticsPanel } from '../components/profile/ProjectAnalyticsPanel';
import './Profile.css';

/**
 * Independent async loader — one per Profile section, so a single failing fetch
 * only affects its own panel (never blanks the page). Returns an AsyncState the
 * shared ProfileSection shell renders (loading / error+retry / ready).
 */
function useAsync<T>(loader: () => Promise<T>): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<AsyncState<T>['status']>('loading');
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    loader()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(normalizeError(err).message);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => run(), [run]);

  return { data, status, error, retry: run };
}

export default function Profile() {
  const streaks = useAsync<UserStreaks>(profileApi.getStreaks);
  const economy = useAsync<Economy>(profileApi.getEconomy);
  const achievements = useAsync<AchievementRow[]>(profileApi.getAchievements);
  const analytics = useAsync<ProjectAnalytics[]>(profileApi.getProjectAnalytics);

  return (
    <div className="profile">
      <h1 className="profile__heading">Profile</h1>
      <StreaksPanel state={streaks} />
      <EconomyPanel state={economy} />
      <AchievementsGallery state={achievements} />
      <ProjectAnalyticsPanel state={analytics} />
    </div>
  );
}
