import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useSettingsSync } from '../hooks/useSettingsSync';
import { normalizeError } from '../api/client';
import type { SettingsPatch } from '../api/types';
import { ToggleRow } from '../components/settings/ToggleRow';
import { ThemeSelect } from '../components/settings/ThemeSelect';
import { TimezoneSelect } from '../components/settings/TimezoneSelect';
import './Settings.css';

/**
 * Settings page: editors for the server-persisted user preferences. Each change
 * PATCHes a single key via useSettingsSync().updateSetting, which refreshes the
 * auth profile on success. Failures revert (the control re-renders from
 * user.settings) and surface a friendly toast. Per-key pending state prevents
 * duplicate concurrent writes.
 */
export default function Settings() {
  const { user } = useAuth();
  const { updateSetting } = useSettingsSync();
  const { showToast } = useToast();
  const [pending, setPending] = useState<keyof SettingsPatch | null>(null);

  if (!user) return null;
  const s = user.settings;
  const isPremium = user.tier === 'premium';
  const isAdmin = user.isAdmin;

  async function save<K extends keyof SettingsPatch>(key: K, value: SettingsPatch[K]) {
    if (pending) return; // guard duplicate concurrent writes
    setPending(key);
    try {
      await updateSetting(key, value);
    } catch (err) {
      showToast(normalizeError(err).message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="settings">
      <h1 className="settings__heading">Settings</h1>

      <ThemeSelect
        value={s.theme}
        pending={pending === 'theme'}
        onChange={(v) => void save('theme', v)}
      />

      <ToggleRow
        label="Focus Mode"
        description="Start on just your top task and hide the rest of the list."
        checked={s.focus_mode_enabled}
        pending={pending === 'focus_mode_enabled'}
        onChange={(v) => void save('focus_mode_enabled', v)}
      />

      <ToggleRow
        label="Achievement toasts"
        description="Celebrate unlocked achievements with a pop-up."
        checked={s.achievement_toasts_enabled}
        pending={pending === 'achievement_toasts_enabled'}
        onChange={(v) => void save('achievement_toasts_enabled', v)}
      />

      <ToggleRow
        label="Project priority"
        description="Let project order influence which tasks rise to the top."
        checked={s.project_priority_enabled}
        pending={pending === 'project_priority_enabled'}
        onChange={(v) => void save('project_priority_enabled', v)}
      />

      <TimezoneSelect
        value={s.timezone}
        pending={pending === 'timezone'}
        onChange={(v) => void save('timezone', v)}
      />

      {isPremium ? (
        <ToggleRow
          label="Show task weight"
          description="Reveal each task's weight and its breakdown."
          checked={s.weight_visibility_enabled}
          pending={pending === 'weight_visibility_enabled'}
          onChange={(v) => void save('weight_visibility_enabled', v)}
        />
      ) : (
        <div className="setting-row">
          <div className="setting-row__text">
            <span className="setting-row__label">Show task weight</span>
            <span className="setting-row__desc">
              Premium feature — see each task's weight and breakdown.
            </span>
          </div>
        </div>
      )}

      {isAdmin && (
        <section className="settings__dev">
          <h2 className="settings__dev-title">Developer</h2>
          <p className="settings__dev-note">
            Admin-only. Toggle premium to exercise premium-tier features.
          </p>
          <ToggleRow
            label="Premium account"
            description="Switch your own tier between free and premium for testing."
            checked={isPremium}
            pending={pending === 'tier'}
            onChange={(v) => void save('tier', v ? 'premium' : 'free')}
          />
        </section>
      )}
    </div>
  );
}
