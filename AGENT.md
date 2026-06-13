# Meridian Agent — What It Does

## The core idea

Meridian is a financial planning agent. The user tells it a goal ("retire at 58", "sell my house and relocate", "optimize my taxes this year") and the agent:

1. Reads their connected accounts and profile
2. Makes a set of explicit assumptions to fill gaps
3. Runs calculations across multiple financial domains (tax, investments, cash flow, estate)
4. Produces a **number** — the headline answer to the goal
5. Produces a **brief** — the reasoning behind that number, in plain language, with levers the user can pull

The agent is not a chatbot that happens to know about finance. It is a planner that produces structured artifacts (briefs, dashboards) and can be talked to when the user wants to explore or challenge those artifacts.

---

## What happens every time the user opens the app

The app always shows the user's current state — no manual refresh. On load:

1. Pull latest account data (balances, holdings, transactions)
2. Re-evaluate each domain against its standing goal (see dashboards below)
3. Surface any changes since last visit ("your tax liability estimate increased by $4k since last week")

Later: push notifications when something material changes (new large transaction, allocation drifts past threshold, a document expires, etc.).

---

## The three things the agent produces

### 1. A Brief (goal-scoped)

Triggered when the user defines a goal. The agent runs a full analysis scoped to that goal and produces:

- **The headline number**: e.g. "You can retire at 58 with $8,200/mo in today's dollars"
- **The assumptions**: explicit list of what the agent assumed (return rate, inflation, spending, Social Security age, etc.)
- **The reasoning**: prose walkthrough of how it got there — what's working, what's at risk, what would change the number
- **The levers**: the 3–5 assumptions that most affect the outcome, surfaced so the user can change them

The brief is a **document**, not a conversation. It persists. The user can annotate it, share it, and return to it.

**Open question:** How granular are briefs? One per goal? Can a user have multiple live briefs?

### 2. Dashboards (domain-scoped)

Ongoing views that aren't tied to a specific goal. Each dashboard covers one domain:

- **Overview**: net worth trajectory, savings rate, big risks
- **Tax**: current-year liability, optimization opportunities, projected future tax drag
- **Cash flow**: income vs. spending, upcoming large outflows
- **Investments**: allocation, drift, fee drag, rebalancing opportunities
- **Estate**: beneficiary coverage, insurance gaps, document status

Each dashboard has a **Next Moves** section: 2–5 specific, actionable things the user should do now, ranked by impact.

Each domain surfaces **findings** — not a score or judgment, but a list of specific, actionable issues the agent identified. No findings = you're in good shape. Findings are ranked by estimated impact.

Each domain has a **standing goal** — not user-specified, but implicit to the domain:
- **Overview**: all user-defined goals (retirement, home, college, etc.) tracked as progress bars; this is also where goals are created and edited
- **Cash Flow**: income covers spending with buffer; accounts are structured with clear purpose; liquidity target met
- **Tax**: minimize current-year liability and future tax drag; assets in right tax buckets; year-end opportunities captured
- **Equity & Compensation**: RSU/option/ESPP strategy defined; vesting events handled tax-efficiently; employer stock concentration below threshold
- **Retirement & Benefits**: tax-advantaged accounts maxed appropriately; backdoor/mega backdoor Roth executed if eligible; employer benefits elected optimally
- **Investments**: portfolio allocated to target; low-cost funds; tax-efficient placement across accounts; rebalanced when drifted
- **Risk & Estate**: insurance adequate for dependents and income; estate documents current; beneficiaries correct

Dashboards refresh on every app open. Regeneration is triggered by data changes, not time.

### 3. Briefs (scenario simulation)

A brief is a **report**. It simulates a scenario ("what if I retire at 58?", "what if I sell my house next year?") and explains the outcome. It does not take any actions.

Briefs are read-only artifacts. The user can:
- Change assumptions and see the headline number update
- Annotate and ask questions inline
- Save and return to them later

Briefs do not interact with dashboards — they are what-if explorations, not the user's actual plan.

---

## How the agent works internally

### Data it has access to

- `profile.json`: user's financial facts (income, accounts, goals, tax situation, family)
- Connected account data: balances, holdings, transactions (via Plaid or manual entry)
- Market/rate constants: tax brackets, contribution limits, assumed returns (hardcoded, see `TECH_DEBT.md`)

### What it does with that data

The agent is a **tool-calling loop**. It has a set of calculation tools (in `src/lib/tools/`) that take structured inputs and return structured outputs. The agent:

1. Decides which tools are relevant to the goal or domain
2. Calls those tools with inputs derived from profile + assumptions
3. Synthesizes the tool outputs into a brief or dashboard

Tools are pure calculation primitives. The agent is the reasoning layer that decides what to calculate and what to say about the results.

### The assumption layer

This is the critical missing piece. When the agent generates a brief, it makes assumptions. Those assumptions need to be:

- **Explicit**: listed in the brief so the user can see them
- **Stored**: persisted alongside the brief output so the system can replay calculations with changed values
- **Typed**: each assumption has a name, value, unit, and range of plausible values

Without explicit assumption storage, the brief is a dead document. With it, you get interactivity and auditability.

**Proposed structure:** `scenario.json` — one per goal/brief — stores the goal, the assumptions, and the tool outputs. The brief is rendered from this file, not regenerated from scratch each time.

---

## The user journey (linear, first time)

1. **Connect accounts** → Plaid link or manual entry → populates profile
2. **Specify a goal** → natural language or structured form → agent extracts goal parameters
3. **Agent generates brief** → full agentic run, ~10–30 seconds → produces `scenario.json` + renders brief
4. **User reads brief** → sees headline number, assumptions, reasoning
5. **User pulls a lever** → changes an assumption → targeted recalculation → brief updates
6. **User asks a question** → opens chat → agent has full context (profile + scenario) → answers inline
7. **User returns later** → dashboards show ongoing state → next moves surface what's changed

---

## What the agent is NOT

- It does not execute trades or move money
- It does not give legally binding financial advice
- It is not a general-purpose chatbot — it always has access to the user's financial context and should use it
- It does not re-read accounts in real time mid-conversation — data is snapshotted at session start

---

## Chat

The user can open a chat at any time, from any screen. The agent always has full context: profile, connected accounts, and whatever dashboard or brief the user is currently looking at. Chat is for:

- Asking questions ("why is my estimated tax so high?")
- Exploring ideas ("what would happen if I maxed my HSA?")
- Getting explanations ("what does tax drag mean for me specifically?")

Chat never takes actions. It can suggest them, and it can kick off a brief if the user wants to simulate something.

---

## Open questions to resolve before building

1. **Brief granularity**: can users have many briefs? Do old ones expire or stay? (Lean: unlimited, persist forever, user can delete)
2. **Account connection**: Plaid first or manual entry first? Determines profile richness at launch.
3. **Multi-goal support**: overview dashboard shows a progress bar per user goal (retire at 58, buy house in 3 years, etc.) simultaneously. Goals are a first-class list the agent tracks, separate from briefs.
4. ~~**What triggers a new brief?**~~ Resolved: explicit "New Brief" button, OR chat intent — agent responds inline with a summary and a "View Brief" button that opens the generated brief. Brief is always a separate artifact, never just a chat reply.
