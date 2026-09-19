# Economy Implementation Tasks

First concrete completion listener. Owns `users.currency_balance` (no migration). Complete & verified (81 tests passing across the backend). Tasks marked `*` optional.

- [x] 1. Config — `economy.premiumEarnRate` (default 1.5) from `ECONOMY_PREMIUM_EARN_RATE`
- [x] 2. economyRepository — `addCurrency` (atomic UPDATE + GREATEST clamp ≥0), `getBalance` (balance:number + tier)
- [x] 3. economyService — `earnRateForTier`, `onTaskCompleted` (round(weight×rate), skip 0, no-op if user missing), `getEconomy`
- [x] 4. Listener registration — `registerAllListeners()` (once-per-process guard) called in `createApp`; registers economy listener
- [x] 5. Controller + route — `economyController.get`; `GET /api/economy` behind authMiddleware; wired in app.ts
- [x] 6. Tests
  - Unit: earnRateForTier; onTaskCompleted amounts (free 40, premium round(41×1.5)=62, zero skip, missing-user no-op)
  - Integration: auth required; free balance = weight; premium = round(weight×1.5); accumulation + user-scoped isolation. Economy suite resets listeners to exactly the economy listener in beforeAll for determinism.
- [x] 7. Verify — typecheck + full `npm test` green (81 tests, 12 suites)
