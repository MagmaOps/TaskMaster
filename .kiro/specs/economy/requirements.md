# Economy Requirements

## Introduction

The Economy feature gives users a virtual currency they earn by completing tasks. Completing a task grants currency equal to its weight-at-completion, multiplied by a tier-based earn rate (free `1×`, premium `1.5×`). The balance is stored on the user and exposed via an API; a future customization store will spend it. This is a monetization experiment (premium earns faster).

Economy is a **completion listener**: it registers with the completion-events dispatcher and reacts to each completed task. It owns the `users.currency_balance` column and uses `weightAtCompletion` from the completion event. It aligns with `docs/prd.md` §3.4 (Virtual Economy) and `docs/technical-specification.md`.

## Glossary

- **Currency Balance**: Integer stored on `users.currency_balance`; the user's spendable total.
- **Earn Rate**: Multiplier applied to earned currency — `1.0` free, configurable premium (default `1.5`).
- **Earn Event**: A completion producing `round(weightAtCompletion × earnRate)` currency.
- **Completion Listener**: Function registered with the dispatcher (from completion-events) invoked per completed task.

## Requirements

### Requirement 1 — Earn currency on completion

**User Story:** As a user, I want to earn currency when I complete a task, so that progress feels rewarding.

#### Acceptance Criteria
1. WHEN a task is completed, THE economy listener SHALL add `round(weightAtCompletion × earnRate)` to the user's `currency_balance`.
2. THE system SHALL use `earnRate = 1.0` for free users and the configured premium rate (default `1.5`) for premium users.
3. THE system SHALL never allow `currency_balance` to become negative.
4. WHEN the earned amount rounds to 0 (e.g. weight 0), THE system SHALL leave the balance unchanged.
5. THE currency update SHALL be a single atomic UPDATE keyed by user id.

### Requirement 2 — Balance API

**User Story:** As a user, I want to see my balance and how fast I earn.

#### Acceptance Criteria
1. WHEN `GET /api/economy` is called with a valid access token, THE system SHALL return `{ balance, earnRate, tier }` for the authenticated user.
2. WHEN called without a valid access token, THE system SHALL return 401.
3. THE `balance` SHALL be a non-negative integer; `earnRate` SHALL reflect the user's tier.

### Requirement 3 — Reliability and isolation

**User Story:** As a user, I want completion to always succeed even if the currency award hiccups.

#### Acceptance Criteria
1. THE economy listener SHALL be registered via `registerCompletionListener` at app startup.
2. WHEN the economy listener throws, THE completion SHALL still succeed (guaranteed by the dispatcher's error isolation).
3. THE listener SHALL scope the update to the completing user only.

### Requirement 4 — Configuration

#### Acceptance Criteria
1. THE premium earn rate SHALL be a named config value (default `1.5`), not a magic number.
2. THE weight used for earning SHALL be the `weightAtCompletion` provided by the completion event (not recomputed).
