# Economy Design

## Overview

Economy is the first concrete completion listener. It awards currency on completion and exposes a balance endpoint. It owns `users.currency_balance` (already in the schema) and needs no migration.

## Components

### config additions
- `economy.premiumEarnRate` (default `1.5`) in `src/config/index.ts`, sourced from `ECONOMY_PREMIUM_EARN_RATE` env with a fallback.

### economyRepository (`src/repositories/economyRepository.ts`)
- `addCurrency(userId, amount): Promise<void>` — `UPDATE users SET currency_balance = GREATEST(currency_balance + $2, 0) WHERE id = $1`. Single atomic statement; clamps ≥ 0.
- `getBalance(userId): Promise<{ balance: number; tier: UserTier }>` — reads `currency_balance` + `tier`. (`currency_balance` is bigint → returned as string by pg; convert to number.)

### economyService (`src/services/economy/economyService.ts`)
- `earnRateForTier(tier): number` — `premium → config.economy.premiumEarnRate`, else `1.0`.
- `onTaskCompleted(event): Promise<void>` — the listener. Determine the user's tier (from `event` we have userId; fetch tier via economyRepository.getBalance or userRepository). Compute `amount = Math.round(event.weightAtCompletion * earnRate)`. If `amount > 0`, `addCurrency`. Never throws meaningfully (dispatcher isolates anyway).
- `getEconomy(userId): Promise<{ balance, earnRate, tier }>` — for the API.

To avoid an extra query, `onTaskCompleted` uses `getBalance` (which already returns tier) to get the tier, then updates. (One read + one write; acceptable. Alternatively read tier only.)

### Listener registration
In `app.ts` (or a small `registerListeners()` called from `createApp`), call `registerCompletionListener(economyService.onTaskCompleted)`. Registration must be idempotent per process; since `createApp` may run per test, guard with a module-level `registered` flag OR register once in `createApp` and rely on tests calling `clearCompletionListeners()` then re-creating. **Chosen approach:** a `registerAllListeners()` function invoked inside `createApp` after routes; tests already call `createApp()` once per suite in `beforeAll`, and `clearCompletionListeners()` in `beforeEach` would wipe them — so instead we register in `createApp` and DO NOT clear in economy tests (only the completion-events unit tests clear). To keep suites independent, `registerAllListeners` guards against double-registration with a flag.

### economyController + economyRoutes
- `GET /api/economy` behind `authMiddleware` → `{ success, data: { balance, earnRate, tier } }`.
- Mounted at `/api/economy` in `app.ts`.

## Interaction with the dispatcher / tests
- The listener is registered when the app is created. Because multiple test suites create apps, `registerAllListeners()` uses a `let registered = false` guard so listeners are added once per process.
- The completion-events unit test that calls `clearCompletionListeners()` runs in its own file; after it clears, its own assertions don't depend on economy. Integration suites that complete tasks will have economy active — that's fine and even desirable (real behavior). Tests that assert exact balances create fresh users so counts are deterministic.

## Testing Strategy
- **Unit:** `earnRateForTier` (free 1.0, premium configured). `onTaskCompleted` with mocked repo: amount = round(weight × rate); amount 0 → no update; premium higher than free.
- **Integration (Supertest + test DB):**
  - complete a task → `GET /api/economy` balance equals the completed task's weight (free rate).
  - premium user (flip tier in DB) earns `round(weight × 1.5)`.
  - balance never negative (award of 0 leaves unchanged).
  - `GET /api/economy` requires auth (401 without token) and is user-scoped.
