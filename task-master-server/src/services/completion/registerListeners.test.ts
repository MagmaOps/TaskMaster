/**
 * Smoke test for listener registration order (Req 10.1).
 *
 * The achievements listener reads `event.streaks`, which the streak listener
 * populates, so achievements MUST be registered AFTER streaks in
 * `registerAllListeners`.
 *
 * Approach: reset the module registry so `registerListeners`' once-per-process
 * guard is fresh, spy on the freshly-imported `completionEvents.registerCompletionListener`
 * BEFORE calling `registerAllListeners`, then inspect the recorded call
 * arguments and compare them by function identity against the streak and
 * achievements listeners imported from the same fresh module graph.
 */

describe('registerAllListeners ordering', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('registers the achievements listener after the streak listener', () => {
    jest.resetModules();

    // Import from the same fresh module graph so identities match the ones
    // registerAllListeners passes.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const events = require('./completionEvents') as typeof import('./completionEvents');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const streakService = require('../streaks/streakService') as typeof import('../streaks/streakService');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const achievementsService = require('../achievements/achievementsService') as typeof import('../achievements/achievementsService');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerAllListeners } = require('./registerListeners') as typeof import('./registerListeners');

    const spy = jest.spyOn(events, 'registerCompletionListener');

    registerAllListeners();

    const registered = spy.mock.calls.map((call) => call[0]);
    const streakIndex = registered.indexOf(streakService.onTaskCompleted);
    const achievementsIndex = registered.indexOf(achievementsService.onTaskCompleted);

    expect(streakIndex).toBeGreaterThanOrEqual(0);
    expect(achievementsIndex).toBeGreaterThanOrEqual(0);
    expect(streakIndex).toBeLessThan(achievementsIndex);
  });
});
