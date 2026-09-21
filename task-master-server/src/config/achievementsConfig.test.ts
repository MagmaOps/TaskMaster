/** Smoke test for the achievements config default (Req 6.1). */

describe('config.achievements.highWeightThreshold', () => {
  const original = process.env.ACHIEVEMENTS_HIGH_WEIGHT_THRESHOLD;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ACHIEVEMENTS_HIGH_WEIGHT_THRESHOLD;
    } else {
      process.env.ACHIEVEMENTS_HIGH_WEIGHT_THRESHOLD = original;
    }
    jest.resetModules();
  });

  it('defaults to 200 when ACHIEVEMENTS_HIGH_WEIGHT_THRESHOLD is unset', () => {
    delete process.env.ACHIEVEMENTS_HIGH_WEIGHT_THRESHOLD;
    jest.resetModules();
    // Re-require after clearing the env so config parses the default.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { config } = require('./index') as typeof import('./index');
    expect(config.achievements.highWeightThreshold).toBe(200);
  });
});
