# TaskMaster - Product Requirements Document

**Version:** 2.0
**Last Updated:** September 18, 2026
**Status:** MVP Specification (self-hosted rebuild)

---

## 1. Product Vision

TaskMaster is a weight-based task management service that removes decision fatigue by automatically prioritizing tasks. Instead of forcing users to manually organize and re-prioritize their tasks daily, TaskMaster uses a weight algorithm that considers task age, priority level, due dates, project importance, and user behavior to calculate what should be done next.

**Core Problem Solved:** Users experience decision fatigue when managing competing priorities across work, personal life, and leisure. Traditional task managers require constant manual re-prioritization, which drains mental energy before any actual work gets done.

**Key Differentiator:** TaskMaster decides for you. Open the app, see "What's Next?" prominently displayed, and start working. No planning overhead, no analysis paralysis.

**Product posture:** TaskMaster is built as a real multi-user SaaS with free and premium tiers. It is initially **self-hosted by the owner on a private Kubernetes (k3s) home lab** and validated locally before being exposed on a public domain. The architecture is designed so the transition from local testing to public web access is a configuration change, not a rewrite.

---

## 2. Target Users

### Primary Personas (4 validated user types):

**ADHD Professional**
- Software developer, creative professional, or knowledge worker
- Struggles with executive function and decision paralysis
- Needs external structure but resists rigid planning systems
- Key need: "Just tell me what to do next" with minimal friction

**Anxious Overachiever**
- Consultant, lawyer, academic, startup founder
- High performer with perfectionism and imposter syndrome
- Everything feels urgent, leading to analysis paralysis
- Key need: External validation that they're working on the "right thing"

**Creative Juggler**
- Freelancer, artist, multi-hyphenate creative
- Juggles client work + personal creative projects
- Struggles with "paid work always dominates passion projects"
- Key need: Automatic balancing of competing life domains

**Busy Parent**
- Working parent managing career + household + kids
- Overwhelmed by mental load: "I'm everyone's task manager"
- Limited time, constant interruptions
- Key need: Cognitive offload, ultra-fast task capture

**Common Thread:** All personas experience decision fatigue and want to offload prioritization decisions to a trusted system they don't need to micromanage.

---

## 3. Core Features (MVP Scope)

### 3.1 Authentication & Accounts

**Sign-in options (in display order):**
1. **Google OAuth (primary, shown first)** — one-tap sign-in with a Google account. This is the recommended path for end users.
2. **Email + password** — traditional credentials for users without Google, or for the owner during early self-hosted testing.

**Account model:**
- One user account can link multiple sign-in methods (a Google identity and/or an email+password credential) to the same underlying user.
- Sessions use short-lived access tokens plus longer-lived refresh tokens so sessions can be revoked and mobile clients stay logged in safely.
- Email addresses are stored lowercase for consistent lookup.

**Rollout note:** Google OAuth is wired into the UI and backend from day one but depends on a Google Cloud OAuth client that will be created later. Until those credentials are configured, the Google button can be present but disabled/hidden via configuration, while email+password remains fully functional for the owner's own use.

### 3.2 Task Management

**Task Creation**
- Quick-add via prominent "+" button in navigation
- Required: subject, priority (high/medium/low)
- Optional: due date, due time, project assignment
- Ultra-fast capture: 2-second task creation target

**Automatic Prioritization**
- Weight algorithm calculates task priority in real-time
- Tasks sorted by weight (highest = most urgent)
- No manual re-ordering needed
- Top task prominently displayed ("What's Next?")

**Task Completion**
- Tap task to open action modal
- Complete, defer, modify, archive, or delete
- Completion triggers achievement checks
- Weight tracking for virtual economy

**Deferral System ("Accountable Procrastination")**
- Three guilt-free deferral options:
  1. **Later Today:** Task hidden temporarily, reappears later today
  2. **Tomorrow:** Task hidden until tomorrow
  3. **Sometime Later:** Priority reduced one level, due date cleared
- Dual-path UI: Swipe left (mobile) or tap task → modal (all devices)
- Each deferral tracked and contributes to weight accumulation
- Special achievement for completing heavily-deferred tasks

**Repeatable Tasks**
- Flag tasks as recurring (daily, weekly, specific days)
- Individual streak tracking per repeatable task
- Automatic due date multiplier brings repeatables to top when scheduled
- Maintains weight between cycles (doesn't reset)

### 3.3 Projects (Optional Organizational Layer)

**Project Creation & Management**
- Create up to 20 projects (enforced limit)
- Located in: Settings → Projects
- Drag-and-drop reordering via burger icon (☰)
- Top of list = highest priority project
- No explicit "Priority #1" labels (order implies priority)

**Project Priority Weighting**
- Global toggle: Enable/Disable project priority system (ON by default)
- When enabled: Project order determines weight multiplier
- Auto-distribution formula: Top project gets +100% weight, bottom gets 0%
  - Example with 4 projects: 100%, 67%, 33%, 0%
- Completely hidden from user (no multiplier numbers shown)
- User just sees: "Reorder to prioritize"

**Multi-Project Tasks**
- Tasks can belong to multiple projects
- Highest-priority project determines weight contribution
- Lower-priority projects used only for filtering/views

**Project Filtering**
- Project selector at top of task list (like a chat switcher)
- Options: "All" (default) or specific project names
- Tap to switch between project views
- Filtered views respect weight sorting

### 3.4 Gamification & Retention

**Achievement System**
- **First task completed:** Welcome achievement
- **Daily streaks:** 1 task/day for 7, 14, 30, 90 days
- **Multiple tasks per day:** Productivity burst achievements
- **Repeatable task streaks:** Per-task streak milestones (7, 30, 100 days)
- **Accountable procrastination:** Special reward for completing heavily-deferred tasks
- **High-weight completion:** Tackle big/old tasks achievements
- **Consistency rewards:** Focus on habit-building over raw productivity

**Toast Celebrations**
- Layer overlay on top of all content
- Cute, friendly congratulatory text (no corporate/dry language)
- Duration: 2-30 seconds
- Dismissible: Tap to close OR auto-dismiss at 30s
- Settings toggle: Can disable achievement toasts (enabled by default)

**Streak Tracking**
- **Daily streak:** Overall app usage (1+ task completed per day)
- **Per-task streaks:** Individual counters for each repeatable task
- Displayed in Profile tab with fire icon 🔥
- Longest streak recorded (lifetime best)

**Virtual Economy (MVP Experiment)**
- Finished task weight = currency earned
- Currency stored for future avatar/UI customization store
- Free users: Standard earning rate
- Premium users: Faster earning rate (monetization test)
- Store implementation: Basic customization options (colors, themes)

### 3.5 Analytics & Insights

**Per-Project Analytics**
- Completion stats by project
- Completion streaks per project
- Weight completed per project (quantifies effort distribution)
- Enables reflection: "Am I working on what I say I prioritize?"

**Progress Reports**
- Daily/weekly/monthly completion counts
- Tasks added vs tasks completed ratio
- Consistency metrics (days active)
- Available in Profile tab

**Weight Visibility (Tiered by User Type)**
- **Free users:** Weight completely hidden (algorithm magic, "just trust it")
- **Premium users:** Optional weight visibility toggle in Settings
  - Shows weight breakdown for each task (age, priority multiplier, project bonus, due date adjustment, deferral accumulation, total)
  - Educational tool: helps users understand the system

**Social Sharing (Organic Marketing)**
- Shareable achievement cards (social-media format)
- Pre-formatted text for social media posts
- Weekly/monthly report snapshots
- Share button in Profile tab

### 3.6 User Interface Structure

**Bottom Navigation (5 Buttons)**
1. **Tasks:** Main task list view (default landing page)
2. **Projects:** Project management/filtering
3. **+ (Large center button):** Quick-add task modal
4. **Profile:** Achievements, streaks, analytics, virtual economy
5. **Settings:** App configuration, project priority toggle, preferences

**Task List View**
- Top task displayed prominently (larger card, highlighted background)
- Remaining tasks in scrollable list below
- Each task card shows: subject, priority badge, due date/time (if set), project tag(s) (if assigned)
- Project selector at top (switch views)
- Optional Focus Mode (Settings toggle): Shows only top task, hides list

**Action Modal (Tap Task)**
- Complete, Later (opens deferral sub-modal), Modify, Archive, Delete
- Deferral sub-modal shows 3 options (Later Today, Tomorrow, Sometime Later)

**Quick-Add Modal (+ Button)**
- Task subject (required), priority selector (required)
- Due date/time pickers (optional, collapsed by default)
- Project multi-select (optional), repeatable toggle (optional)
- Auto-focus on subject input

---

## 4. Weight Algorithm Philosophy

**Core Principles:**

1. **Time Makes Everything Important** — old low-priority tasks eventually outweigh new high-priority tasks; nothing is forgotten forever.
2. **Multi-Factor Calculation** — age, priority level, due date proximity, project priority, deferral accumulation, repeatable due-date boost.
3. **Predictable & Consistent** — same inputs always produce same output; no random variation.
4. **Completely Automated** — no manual re-prioritization; weight recalculated on every task list fetch.
5. **Hidden Complexity, Simple Surface** — free users never see numbers; premium users can peek under the hood.

(Exact formulas and constants live in `docs/technical-specification.md`.)

---

## 5. User Experience Principles

**Mobile-First PWA** — installable (Add to Home Screen), responsive, thumb-friendly bottom nav. Online-only for MVP; offline support is post-MVP.

**"What's Next?" Prominence** — top task is visually dominant; open app → see next action → start working.

**Progressive Complexity** — new users see a simple list + quick-add; features reveal through use.

**Guilt-Free Procrastination** — "Later" is normalized, friendly, and tracked positively.

**"Everything is Needed" Philosophy** — work, personal, and leisure tasks are equal; the app doesn't judge task types.

**Settings Over Defaults** — defaults optimized for primary personas; power users get Focus Mode, toast disable, and (premium) weight visibility.

---

## 6. Technical Constraints

**Platform & Stack**
- Frontend: React 18+ with **TypeScript**, built with **Vite**, delivered as a Progressive Web App
- Backend: Node.js 18+ with Express.js in **TypeScript**
- Database: PostgreSQL 14+
- Authentication: JWT access + refresh tokens; Google OAuth 2.0 and bcrypt email/password credentials

**Hosting & Infrastructure (self-hosted)**
- Container images published to Docker Hub under the `magmakomer` namespace (`magmakomer/taskmaster-backend`, `magmakomer/taskmaster-frontend`)
- Deployed to a private **k3s** cluster spanning multiple physical nodes
- GitOps delivery via **ArgoCD**; manifests versioned in this monorepo
- Secrets managed with **Sealed Secrets** (encrypted manifests committed to Git)
- **Local-first:** the owner builds and tests entirely on the local cluster first; a public domain, ingress TLS (cert-manager + Let's Encrypt), and external exposure are added after validation
- No AWS, no Redis, no managed database — everything runs in-cluster

**Performance Requirements**
- Task list load: < 1 second
- Quick-add task: < 500ms response time
- Weight calculation: < 100ms for 1000 tasks
- Mobile-responsive: works on screens 320px+ width

**Security Requirements**
- HTTPS required once publicly exposed (TLS terminated at ingress via cert-manager/Let's Encrypt)
- Password hashing: bcrypt (minimum 10 salt rounds, 12 in production)
- Access tokens short-lived; refresh tokens revocable
- SQL injection prevention: parameterized queries
- CORS: whitelist the frontend origin
- Rate limiting on auth endpoints (brute-force protection)
- Secrets never baked into images; injected via k8s Secrets sourced from Sealed Secrets

**Browser Support**
- Modern browsers (Chrome, Firefox, Safari, Edge — last 2 versions)
- Mobile browsers: iOS Safari 14+, Android Chrome 90+
- No IE11 support

**Scalability Targets (MVP)**
- 100–1000 users, 10,000–100,000 tasks total
- Single-node Postgres with a PVC initially; scale-up path via larger resources and read replicas post-MVP

---

## 7. Repository & Delivery Model

- **Monorepo** containing the frontend, backend, and Kubernetes/GitOps manifests together.
- CI builds two images and pushes them to the `magmakomer` Docker Hub namespace.
- ArgoCD watches the `k8s/` manifests and syncs the cluster to match Git.
- The same manifests work locally (no public domain) and, after validation, gain a public host + TLS.

---

## 8. Success Metrics (Beta Phase)

**Retention:** 7-day retention >40%, 30-day retention >20%.
**Engagement:** DAU tracking, 5–10 tasks created/user/week, >60% completion rate.
**Feature Adoption:** project usage >50%, achievement engagement (5+ per user), healthy deferral usage (1–3 per task), repeatable-task adoption.
**Qualitative:** user interviews, NPS >30, feedback themes.
**Monetization Validation:** virtual-economy engagement, premium interest survey, price-sensitivity testing.

---

## 9. Out of Scope for MVP

- ❌ Native mobile apps (iOS/Android stores)
- ❌ Push notifications
- ❌ Offline-first functionality (Service Worker sync, IndexedDB)
- ❌ Team/family collaboration or shared lists
- ❌ Third-party integrations (Google Calendar, Todoist import, etc.)
- ❌ Mascot/assistant system
- ❌ Advanced ML personalization
- ❌ Email reminders/notifications
- ❌ Subtasks or task dependencies
- ❌ File attachments or comments
- ❌ Time tracking / Pomodoro
- ❌ Calendar/timeline view
- ❌ Task templates / batch operations
- ❌ Multi-language support (English only initially)

**Note:** Dark mode is **in scope** for this rebuild (it was previously deferred). A single accessible theme plus dark mode ships in MVP.

**Rationale:** Focus on the core value proposition (weight algorithm + "What's Next?") and validate product-market fit before adding complexity.

---

## 10. Future Roadmap (Post-MVP)

**Phase 2 (3–6 months):** Offline-first PWA (Service Workers), push notifications, email reminders, accessibility improvements (WCAG 2.1 AA), public domain + TLS hardening.

**Phase 3 (6–12 months):** Native mobile apps (Capacitor/React Native), mascot/assistant (premium), third-party integrations, advanced analytics.

**Phase 4 (12+ months):** ML personalization, developer API, team/enterprise version, home-screen widgets.

---

## 11. Design Principles Summary

1. **Simplicity First** — when in doubt, choose the simpler option.
2. **Mobile Thumb Zone** — primary actions reachable one-handed.
3. **Zero Empty States** — every dataless screen has helpful placeholder + CTA.
4. **Instant Feedback** — every action gets immediate visual response.
5. **Fail Gracefully** — friendly, actionable error messages.
6. **Progressive Enhancement** — core works, then enhances.
7. **Performance Budget** — no action >3s; loading states for anything >500ms.
8. **Accessibility Mindset** — semantic HTML, ARIA, keyboard nav, contrast.
9. **Data Privacy** — never share user data; clear privacy policy.
10. **Delight in Details** — small animations create emotional connection.

---

## 12. Open Questions & Decision Points

1. Algorithm tuning: are the weight multipliers balanced? (Answer via testing.)
2. Deferral limits: cap "Later" clicks per task per day?
3. Empty-state strategy: encouraging message vs tutorial?
4. Project default: auto-enable project priority weighting on first project?
5. Reminder frequency (post-MVP): how often is helpful vs annoying?
6. Premium pricing: $3 vs $5 vs $10/mo? Freemium vs trial?
7. Data export format: JSON/CSV/PDF?
8. Deletion behavior: keep completed tasks forever or auto-archive after 90 days?
9. Multi-device sync edge cases.
10. Weight transparency for free users: any hint vs fully hidden?

---

## 13. Competitive Positioning

| Feature | Todoist | Things | TickTick | **TaskMaster** |
|---------|---------|--------|----------|----------------|
| Manual priority | ✅ P1-P4 | ✅ Tags | ✅ Priority | ❌ Auto-calculated |
| Planning required | ✅ | ✅ | ✅ | ❌ Algorithm decides |
| "Later" action | ❌ | ❌ | ✅ | ✅ Guilt-free + tracked |
| Gamification | ⚠️ Karma | ❌ | ⚠️ Habits | ✅ Achievements + streaks |
| Project weighting | ❌ Manual | ❌ Manual | ❌ Manual | ✅ Auto-distributed |

**Messaging:** "Decision fatigue killing your productivity? TaskMaster tells you what's next so you can focus on doing."

---

## Appendix: Glossary

- **Weight:** numeric score (higher = more urgent) determining task order.
- **Deferral:** user action to postpone a task.
- **Accountable Procrastination:** philosophy that normalizes and tracks "Later."
- **Project Priority:** order of projects (1–20) that determines weight multiplier.
- **Repeatable Task:** recurring task with schedule and per-task streak.
- **Streak:** consecutive days completing at least one task (daily) or a specific repeatable.
- **Achievement:** milestone unlocked based on behavior.
- **Virtual Economy:** weight → currency for customization (monetization experiment).
- **What's Next?:** prominent display of the highest-weight task.
- **Focus Mode:** setting to show only the top task.

---

**End of Product Requirements Document**

*For technical implementation details, see: `docs/technical-specification.md`*
