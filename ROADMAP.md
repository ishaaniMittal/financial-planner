# Meridian — Product Roadmap

## Guiding principle

Each phase should be usable on its own. Don't build infrastructure that has no surface until phase 3 — every phase ships something a real user can open and get value from.

---

## Phase 1 — Foundation: Profile + Overview

**Goal:** User can log in, see their financial picture, and set goals. No agent yet. Validates the data model and gives something to look at.

### Features
- [ ] Manual profile entry (income, accounts, balances, family, tax filing status)
- [ ] Goals list: add/edit/delete goals with type (retirement, home, college, other), target date, target amount
- [ ] Overview dashboard: goal progress bars (static, based on current savings rate + simple projection)
- [ ] Net worth summary: assets minus liabilities, broken down by account type
- [ ] Account structure: list of accounts with type, institution, balance, tax treatment (taxable / tax-deferred / tax-free)

### Data model established
- `profile.json` — user facts, income, family
- `goals.json` — list of goals with parameters
- `accounts.json` — connected/entered accounts

### Success criteria
A user can enter their financial situation from scratch and see a meaningful overview in under 10 minutes.

---

## Phase 2 — Agent Core: Domain Findings

**Goal:** Agent runs on app open, evaluates each domain, surfaces findings. This is the core loop.

### Features
- [ ] Agent runs on login against profile + accounts
- [ ] **Tax** domain: current-year liability estimate, asset location check, top findings with estimated impact
- [ ] **Investments** domain: allocation vs. target, concentration check, fee drag estimate
- [ ] **Retirement & Benefits** domain: contribution limit checks (401k, IRA, HSA), backdoor Roth eligibility
- [ ] **Cash Flow** domain: income vs. spending, liquidity check (months of expenses in cash)
- [ ] Each domain shows: findings ranked by impact, clean "no findings" state
- [ ] Overview: finding count per domain tab, goal progress bars (now agent-calculated, not static)
- [ ] "What changed since last visit" delta surfaced on Overview

### Architecture
- Agent invoked per domain independently (not one monolithic run)
- Each domain produces a structured findings object stored in `dashboard-state.json`
- Dashboard renders from stored state, not live agent output on every page load

### Success criteria
User opens the app and within 30 seconds sees at least one specific, accurate finding they didn't already know.

---

## Phase 3 — Chat

**Goal:** User can ask any question about their financial data and get a specific, contextual answer.

### Features
- [ ] Persistent chat panel accessible from any screen
- [ ] Agent has full context: profile, accounts, goals, current domain being viewed
- [ ] Answers cite the user's actual numbers, not generic advice
- [ ] Chat can explain any finding ("why is this flagged?")
- [ ] Chat can explore what-if questions inline ("what if I increase my 401k contribution?")
- [ ] When simulation intent detected, agent responds with inline summary + "View Brief" button

### Success criteria
User asks about their tax situation and gets an answer that references their specific income, accounts, and situation.

---

## Phase 4 — Briefs

**Goal:** User can simulate a scenario and get a full analysis report with interactive assumption levers.

### Features
- [ ] "New Brief" button — user describes a scenario in natural language
- [ ] Agent generates brief: headline number, assumptions list, reasoning prose, key levers
- [ ] Assumption levers: change a value and headline updates (targeted recalculation, not full re-run)
- [ ] Brief persists: saved, returnable, deletable
- [ ] Brief library: list of all briefs with scenario name and headline number
- [ ] Chat inside brief with brief context loaded
- [ ] Brief annotations: user can leave inline comments

### Scenario types supported at launch
- Retirement age simulation ("what if I retire at 55 vs. 62?")
- Goal feasibility ("can I afford a $2M house in 3 years?")
- Income change ("new job with $50k pay cut but more equity")
- Tax event ("what if I sell all my employer stock this year?")

### Data model
- `scenario-{id}.json` — goal, typed assumptions with ranges, tool outputs, brief text

### Success criteria
User creates a retirement brief, changes the retirement age lever, headline updates in under 3 seconds.

---

## Phase 5 — Equity & Compensation Domain

**Goal:** Full coverage of the domain most distinctive to Meridian's target user.

### Features
- [ ] RSU vesting schedule: grant date, vest schedule, current share price
- [ ] Option grants: type (ISO/NSO), strike price, expiration, vesting status
- [ ] ESPP: enrollment status, discount rate, offering period
- [ ] Concentration analysis: employer stock as % of net worth (vested + unvested)
- [ ] Vesting event calendar: upcoming dates with projected tax impact
- [ ] RSU sell strategy findings: immediate sale vs. hold, tax impact
- [ ] Option exercise timing: AMT risk for ISOs, expiration risk
- [ ] Cross-domain: equity events surface in Tax domain when year-end timing is relevant

### Success criteria
User with active RSU grants sees upcoming vesting events, estimated tax withholding gap, and a specific sell-timing recommendation.

---

## Phase 6 — Risk & Estate Domain

**Goal:** Cover the protection layer — consistently the most neglected domain for high-income earners.

### Features
- [ ] Insurance inventory: life, disability, umbrella — carrier, coverage amount, last reviewed date
- [ ] Estate documents checklist: will, trust, POA, healthcare directive — status and date
- [ ] Beneficiary register: per-account designations with last-reviewed date
- [ ] Coverage gap analysis: life insurance need vs. current coverage (income replacement model)
- [ ] Staleness detection: flag docs older than 3 years or predating major life events
- [ ] Findings ranked by severity

### Success criteria
User enters insurance and estate info and sees at least one finding they hadn't thought about.

---

## Phase 7 — Account Connection (Plaid)

**Goal:** Replace manual entry with live connected accounts.

### Features
- [ ] Plaid Link integration: bank, brokerage, credit card accounts
- [ ] Account sync on app open: latest balances and transactions
- [ ] Transaction categorization: map to cash flow categories
- [ ] Holdings sync: current positions and prices for investment accounts
- [ ] Manual entry remains available for users who prefer not to connect

### Notes
Manual entry first is the right call — validates the product before Plaid's pricing and integration complexity. This phase pays off once the product is proven.

### Success criteria
User connects a brokerage account and sees holdings populate automatically in the Investments domain.

---

## Phase 8 — Notifications & Proactive Monitoring

**Goal:** Meridian reaches out when something changes, not just when the user opens the app.

### Features
- [ ] Alerts for:
  - RSU vest approaching (7 days out) with estimated tax impact
  - Large transaction detected (configurable threshold)
  - Allocation drift past threshold
  - Year-end tax opportunity window (October–December reminder)
  - Estate document approaching staleness
  - Goal progress deviation (off track by >10%)
- [ ] Notification preferences: per-category on/off, frequency cap
- [ ] Weekly "what changed" digest: findings delta since last week

### Success criteria
User receives a pre-vest RSU notification with tax impact estimate without opening the app.

---

## What's intentionally out of scope

- **Account execution**: no trades, transfers, or money movement
- **Tax filing**: analysis only, not a TurboTax replacement
- **Advisor marketplace**: not a referral business
- **Mobile native app**: web-first; native is a later decision
- **Multi-user / joint accounts**: single user profile for now; joint finances modeled as one

---

## Build order summary

| Phase | What ships | Why this order |
|-------|-----------|----------------|
| 1 | Profile + Overview shell | Establishes data model; something real to look at |
| 2 | Agent findings (4 domains) | The core value loop — findings on every open |
| 3 | Chat | Low-lift given agent is running; high daily value |
| 4 | Briefs | The differentiating feature; needs agent + chat first |
| 5 | Equity & Comp domain | Target user's most complex and highest-stakes domain |
| 6 | Risk & Estate domain | Completes the 7-domain picture |
| 7 | Plaid integration | Live data replaces manual entry |
| 8 | Notifications | Extends value beyond active sessions |
