# Tech Debt & Future Improvements

Decisions made for speed or simplicity that should be revisited as the app grows.
Each entry records what was hardcoded, why, and what a better solution looks like.

---

## Hardcoded fund metadata (fee comparison + overlap detection)

**File:** `src/lib/tools/fund-analysis.ts`
**Added:** 2025-06-11

**What's hardcoded:** A static lookup table of ~60 common ETFs and mutual funds with expense ratios, asset class, issuer, and known cheaper/equivalent substitutes. Fund overlap between tickers (e.g. VTI ≈ VTSAX ≈ FSKAX) is encoded manually.

**Why:** Financial data APIs (Morningstar, ETF.com, Financial Modeling Prep, Polygon.io) require paid keys and add latency. For a personal tool covering a known universe of retail ETFs, a static table is sufficient.

**Better solution:** Integrate a financial data API to fetch live expense ratios, fund composition, and overlap scores. Good candidates:
- [Financial Modeling Prep](https://financialmodelingprep.com/developer/docs/) — ETF holdings + expense ratios, ~$15/mo
- [Polygon.io](https://polygon.io/) — broad market data
- [ETF.com API](https://www.etf.com/) — purpose-built ETF analytics
- Morningstar Direct (enterprise)

**Trigger to fix:** When users report their fund isn't in the table, or when expense ratios drift enough to produce wrong recommendations.

---

## Hardcoded 2025 federal tax brackets

**Files:** `src/lib/tools/advanced-tax.ts`, `src/lib/tools/cash-flow.ts`, `src/lib/tools/portfolio-checks.ts`
**Added:** 2025-06-11

**What's hardcoded:** 2025 IRS federal income tax brackets (single and MFJ) and Roth IRA phaseout thresholds. Duplicated across multiple tool files.

**Why:** Tax brackets change annually but are published months in advance. A static table is sufficient for a personal tool targeting a single tax year.

**Better solution:**
- Centralize brackets into a single `src/lib/tax-data.ts` module (easy win — do this soon)
- Source live bracket data from IRS publications or a tax data API
- Add a `tax_year` parameter to all tools so users can model different years

**Trigger to fix:** When 2026 tax year arrives, or when a user asks about a year other than 2025.

---

## Hardcoded RSU withholding default (22%)

**File:** `src/lib/tools/advanced-tax.ts`
**Added:** 2025-06-11

**What's hardcoded:** Default supplemental withholding rate of 22% (federal flat rate for supplemental wages under $1M).

**Why:** Employer withholding on RSUs is almost always the flat supplemental rate; actual rate varies by employer payroll setup.

**Better solution:** Accept employer-reported withholding from Plaid/bank data when available. Add a `withholding_pct` field to RSU schedule data in the profile.

**Trigger to fix:** When integrating real payroll or bank data.

---

## Hardcoded 529 target education cost default ($350,000)

**File:** `src/lib/tools/benefits-equity.ts` — `plan_529`
**Added:** 2025-06-12

**What's hardcoded:** Default target education cost of $350,000 (4-year private university in today's dollars). Also hardcodes 7% nominal return assumption.

**Why:** College cost projections require current tuition data and inflation assumptions. College Board publishes annual cost data but no free API exists.

**Better solution:** Integrate College Board trends data or allow user to specify school type (public/private) with a configurable inflation rate. Candidates: College Board Cost Trends, Sallie Mae How America Pays survey.

**Trigger to fix:** When users ask about specific schools or want tuition inflation modeling.

---

## Hardcoded state 529 deduction table

**File:** `src/lib/tools/benefits-equity.ts` — `plan_529`
**Added:** 2025-06-12

**What's hardcoded:** State tax deduction eligibility and amounts for ~12 states. Most states omitted.

**Why:** No free comprehensive API for 529 state benefits. Manual table for most common states.

**Better solution:** Savingforcollege.com publishes a full state deduction table. Could scrape or find a data provider that covers all 50 states + DC.

**Trigger to fix:** When a user's state isn't in the table and produces wrong results.

---

## Hardcoded PPO comparison defaults in compare_health_plans

**File:** `src/lib/tools/benefits-equity.ts` — `compare_health_plans`
**Added:** 2025-06-12

**What's hardcoded:** When PPO parameters aren't provided, defaults to HDHP premium + $200/mo, $500 deductible, $3,000 OOP max. Also hardcodes 20% coinsurance assumption.

**Why:** PPO plan details are employer-specific and not available without benefits enrollment data.

**Better solution:** Read employer benefits from a structured benefits file or HR integration. Both plans should come from the user's actual open enrollment options.

**Trigger to fix:** When user provides PPO plan details for accurate comparison.

---
