import type { Economy } from '../../api/types';
import type { AsyncState } from './profileFormat';
import { ProfileSection } from './ProfileSection';

/** Virtual currency balance. Read-only; premium users see an "earning faster" note. */
export function EconomyPanel({ state }: { state: AsyncState<Economy> }) {
  return (
    <ProfileSection title="Balance" state={state}>
      {(data) => (
        <div>
          <div className="economy__balance">{data.balance.toLocaleString()}</div>
          <p className="economy__note">
            Coins earned by completing tasks.
            {data.tier === 'premium' && ' As a premium member, you earn faster.'}
          </p>
        </div>
      )}
    </ProfileSection>
  );
}
