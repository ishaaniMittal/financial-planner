# Agent Roadmap

Financial planning agent build-out plan, organized by phase.
The goal: an agent that can both proactively diagnose ("what do I need to work on?")
and handle deep targeted questions in any financial planning category.

---

## Current state (as of 2025-06-11)

**23 tools across 6 categories:**
- Cash Flow & Contributions: `get_contribution_limits`, `check_contribution_pace`, `detect_idle_cash`, `suggest_rebalancing`, `check_employer_match`
- Tax: `calculate_tax_bracket`, `check_roth_eligibility`, `analyze_tax_opportunities`
- Asset Location: `get_placement_rules`, `optimize_asset_location`, `calculate_tax_drag`
- Holdings Analysis: `analyze_holdings`, `analyze_asset_class_allocation`
- Retirement & Goals: `project_retirement`, `analyze_goal_funding`
- Portfolio Checks: `check_employer_match`, `check_roth_eligibility`, `analyze_asset_class_allocation`
- Advanced: `analyze_fund_overlap`, `plan_rsu_taxes`, `plan_roth_conversion`
- Visualization: `visualize`, `save_to_report`

**Profile captures:** accounts, holdings, tax, monthly history, goals, income, household

---

## Phase 1 — Diagnostic tool (next session, no profile changes needed)

**Build `run_financial_diagnostic`** — a master tool that calls all existing tools,
synthesizes the results, and returns a categorized, prioritized action list.

This answers the "I have no idea where to start" question. Output should look like
the spreadsheet the user shared: categories + specific action items + priority.

Categories to cover in the diagnostic:
1. Cash flow & contributions (pace, idle cash, employer match)
2. Tax efficiency (bracket, Roth eligibility, asset location, tax drag)
3. Retirement & goals (FIRE timeline, goal conflicts, funding gaps)
4. Portfolio health (allocation, fund overlap, concentration, expense ratios)
5. Benefits (RSU strategy, Roth conversion opportunity)
6. Gaps (things the profile is missing that limit the analysis)

The diagnostic should also flag what data is missing from the profile and what
additional information would unlock better analysis.

---

## Phase 2 — Profile expansion + quick-win tools

### Profile schema additions needed:
- `dependents`: name, age, relationship (for 529/UTMA, estate planning, insurance)
- `liabilities`: mortgage, student loans, auto loans (for net worth, home affordability)
- `benefits`: health plan type (HDHP/PPO), HSA eligibility, FSA, stock options grants
- `stock_options`: ticker, grant date, strike price, shares, type (ISO/NSO), vest schedule
- `spending`: monthly categories (or total monthly spend) for savings rate analysis
- `planned_moves`: state residency changes with dates (for equity timing)

### Tools to build:
- **`analyze_mega_backdoor_roth`** — check if 401k plan allows after-tax contributions + in-plan Roth conversion; calculate how much additional Roth space is available beyond the $23,500 limit (up to $70,000 total 2025 limit)
- **`compare_health_plans`** — HDHP vs PPO break-even: premium difference vs deductible + OOP max, factoring in HSA contribution tax savings
- **`plan_stock_options`** — ISO vs NSO tax treatment, AMT exposure for ISOs, optimal exercise timing, 83(b) election for early exercise
- **`plan_529`** — contribution amount for education goal, state tax deduction if applicable, superfunding (5-year gift tax election), UTMA vs 529 tradeoffs
- **`calculate_net_worth`** — assets minus liabilities, liquid vs illiquid breakdown

---

## Phase 3 — Complex/specialized tools

These require more design work or specialized domain knowledge:

- **`plan_state_residency_timing`** — WA→CA move: equity vesting events before vs after move, source-income rules, how many days in each state affects tax domicile. High value for the user's specific situation (Meta/Amazon RSUs + WA→CA).
- **`plan_foreign_accounts`** — NRE/NRO account strategy: remittance timing, FBAR filing threshold ($10k aggregate), FATCA obligations, tax treaty implications (US-India). NRE interest is tax-free in India but taxable in US.
- **`plan_gift_and_inheritance`** — asset transfer from parents: annual gift exclusion ($18k/person 2025), stepped-up basis on inherited assets, gifting appreciated vs cash, estate tax threshold ($13.6M 2025).
- **`plan_concentration_unwind`** — Meta/Amazon: tax-aware sell schedule across multiple years, options for hedging without triggering constructive sale, charitable giving with appreciated shares (DAF), exchange funds.
- **`analyze_insurance_needs`** — life insurance (income replacement × years), disability insurance (60-70% income), umbrella policy threshold (net worth based). Needs dependents + liabilities data from Phase 2.
- **`plan_estate_basics`** — beneficiary designation audit across all accounts, will/trust status, guardianship for Saachi, TOD/POD designations.

---

## Phase 4 — Spending & budget (after bank connectivity)

Transaction-level analysis requires real spending data — either via Plaid or CSV import.
Build after bank account connection is implemented.

- Monthly spending by category vs budget
- Savings rate (income - spending / income)
- Irregular expense detection (big one-time costs)
- Cash flow forecasting (upcoming large expenses vs available cash)

---

## Known tech debt

See `TECH_DEBT.md` for specific entries. Top items:
1. Tax brackets duplicated across 3 files — centralize into `src/lib/tax-data.ts`
2. Fund metadata hardcoded — replace with financial data API when ready
3. RSU withholding default hardcoded at 22%

---

## User's specific situation (context for future sessions)

- Has a child: Saachi (529/UTMA, estate planning needed)
- Parents transferring assets to user (gift/inheritance planning)
- Has Indian accounts: NRE and NRO (FBAR/FATCA obligations)
- WA→CA move in progress or planned (RSU/options timing critical)
- Concentrated positions in Meta and Amazon
- Has stock options in addition to RSUs
- Evaluating Seattle home purchase
- Interested in HDHP + HSA optimization
- Wants mega backdoor Roth setup
