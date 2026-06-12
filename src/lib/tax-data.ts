/**
 * Centralized IRS tax data for 2025.
 *
 * UPDATE ANNUALLY: Each October/November, the IRS publishes the following year's
 * inflation-adjusted figures via a Revenue Procedure (e.g. Rev. Proc. 2024-61).
 * Update this file and bump TAX_YEAR. All tools import from here — one change
 * covers the entire codebase.
 *
 * Source: IRS Rev. Proc. 2024-61 (2025 figures)
 * See TECH_DEBT.md for the plan to automate this via a live data source.
 */

export const TAX_YEAR = 2025

// ---------------------------------------------------------------------------
// Federal income tax brackets
// Format: [upper bound of bracket, marginal rate]
// ---------------------------------------------------------------------------

export const FEDERAL_BRACKETS_SINGLE: [number, number][] = [
  [11_925,   0.10],
  [48_475,   0.12],
  [103_350,  0.22],
  [197_300,  0.24],
  [250_525,  0.32],
  [626_350,  0.35],
  [Infinity, 0.37],
]

export const FEDERAL_BRACKETS_MFJ: [number, number][] = [
  [23_850,   0.10],
  [96_950,   0.12],
  [206_700,  0.22],
  [394_600,  0.24],
  [501_050,  0.32],
  [751_600,  0.35],
  [Infinity, 0.37],
]

export const FEDERAL_BRACKETS_HOH: [number, number][] = [
  [17_000,   0.10],
  [64_850,   0.12],
  [103_350,  0.22],
  [197_300,  0.24],
  [250_500,  0.32],
  [626_350,  0.35],
  [Infinity, 0.37],
]

export function getBrackets(filingStatus: string): [number, number][] {
  if (filingStatus === 'married_filing_jointly') return FEDERAL_BRACKETS_MFJ
  if (filingStatus === 'head_of_household')      return FEDERAL_BRACKETS_HOH
  return FEDERAL_BRACKETS_SINGLE
}

// ---------------------------------------------------------------------------
// Long-term capital gains rates (taxable income thresholds)
// ---------------------------------------------------------------------------

export const LTCG_BRACKETS_SINGLE: [number, number][] = [
  [48_350,   0.00],
  [533_400,  0.15],
  [Infinity, 0.20],
]

export const LTCG_BRACKETS_MFJ: [number, number][] = [
  [96_700,   0.00],
  [600_050,  0.15],
  [Infinity, 0.20],
]

// ---------------------------------------------------------------------------
// Net Investment Income Tax (NIIT)
// ---------------------------------------------------------------------------

export const NIIT_RATE = 0.038
export const NIIT_THRESHOLD_SINGLE = 200_000
export const NIIT_THRESHOLD_MFJ    = 250_000

export function niitApplies(agi: number, filingStatus: string): boolean {
  const threshold = filingStatus === 'married_filing_jointly'
    ? NIIT_THRESHOLD_MFJ
    : NIIT_THRESHOLD_SINGLE
  return agi > threshold
}

// ---------------------------------------------------------------------------
// Roth IRA contribution phaseout (MAGI thresholds)
// ---------------------------------------------------------------------------

export const ROTH_IRA_PHASEOUT: Record<string, { start: number; end: number }> = {
  single:                    { start: 150_000, end: 165_000 },
  married_filing_jointly:    { start: 236_000, end: 246_000 },
  married_filing_separately: { start: 0,       end: 10_000  },
  head_of_household:         { start: 150_000, end: 165_000 },
}

// ---------------------------------------------------------------------------
// IRA & retirement account contribution limits
// ---------------------------------------------------------------------------

export const CONTRIBUTION_LIMITS = {
  ira:               7_000,
  ira_catchup_50:    1_000,   // additional catch-up if age >= 50
  k401:             23_500,
  k401_catchup_50:   7_500,   // age 50–59 and 64+
  k401_catchup_60:  11_250,   // age 60–63 (SECURE 2.0 enhanced catch-up)
  k401_total_limit: 70_000,   // employer + employee combined (415 limit)
  hsa_individual:    4_300,
  hsa_family:        8_550,
  hsa_catchup_55:    1_000,   // additional if age >= 55
  espp_fmv:         25_000,   // fair market value limit
  sep_ira_pct:       0.25,    // 25% of compensation
  sep_ira_max:      70_000,
}

// ---------------------------------------------------------------------------
// Standard deductions
// ---------------------------------------------------------------------------

export const STANDARD_DEDUCTION: Record<string, number> = {
  single:                    15_000,
  married_filing_jointly:    30_000,
  head_of_household:         22_500,
  married_filing_separately: 15_000,
}

// ---------------------------------------------------------------------------
// State income tax rates (flat or top marginal)
// Hardcoded — see TECH_DEBT.md for plan to replace with live API.
// ---------------------------------------------------------------------------

export const STATE_RATES: Record<string, number> = {
  AL: 0.050, AK: 0.000, AZ: 0.025, AR: 0.044, CA: 0.093,
  CO: 0.044, CT: 0.070, DE: 0.066, FL: 0.000, GA: 0.055,
  HI: 0.110, ID: 0.058, IL: 0.0495,IN: 0.030, IA: 0.057,
  KS: 0.057, KY: 0.040, LA: 0.030, ME: 0.075, MD: 0.0575,
  MA: 0.050, MI: 0.0425,MN: 0.098, MS: 0.047, MO: 0.048,
  MT: 0.069, NE: 0.068, NV: 0.000, NH: 0.000, NJ: 0.1075,
  NM: 0.059, NY: 0.109, NC: 0.045, ND: 0.025, OH: 0.035,
  OK: 0.047, OR: 0.099, PA: 0.030, RI: 0.060, SC: 0.065,
  SD: 0.000, TN: 0.000, TX: 0.000, UT: 0.046, VT: 0.086,
  VA: 0.057, WA: 0.000, WV: 0.065, WI: 0.076, WY: 0.000,
  DC: 0.1075,
}

export function getStateRate(state: string): number {
  return STATE_RATES[state.toUpperCase()] ?? 0.05  // default 5% if unknown
}

// ---------------------------------------------------------------------------
// Shared tax math utilities
// (Import these instead of re-implementing in each tool file)
// ---------------------------------------------------------------------------

/** Total federal income tax owed on the given income. */
export function federalTaxOwed(income: number, filingStatus: string): number {
  const brackets = getBrackets(filingStatus)
  let tax = 0, prev = 0
  for (const [limit, rate] of brackets) {
    if (income <= limit) { tax += (income - prev) * rate; break }
    tax += (limit - prev) * rate
    prev = limit
  }
  return tax
}

/** Marginal federal rate at the given income level. */
export function federalMarginalRate(income: number, filingStatus: string): number {
  for (const [limit, rate] of getBrackets(filingStatus)) {
    if (income <= limit) return rate
  }
  return 0.37
}

/** Dollars remaining before crossing into the next federal bracket. */
export function roomInCurrentBracket(income: number, filingStatus: string): number {
  for (const [limit] of getBrackets(filingStatus)) {
    if (income < limit) return limit - income
  }
  return 0
}

/** IRA contribution limit for a given age (includes catch-up). */
export function iraLimit(age: number): number {
  return age >= 50
    ? CONTRIBUTION_LIMITS.ira + CONTRIBUTION_LIMITS.ira_catchup_50
    : CONTRIBUTION_LIMITS.ira
}

/** 401k employee contribution limit for a given age. */
export function k401Limit(age: number): number {
  if (age >= 60 && age <= 63) return CONTRIBUTION_LIMITS.k401 + CONTRIBUTION_LIMITS.k401_catchup_60
  if (age >= 50)              return CONTRIBUTION_LIMITS.k401 + CONTRIBUTION_LIMITS.k401_catchup_50
  return CONTRIBUTION_LIMITS.k401
}

/** Allowed Roth IRA direct contribution given MAGI and filing status. Returns 0 if ineligible. */
export function allowedRothContribution(magi: number, filingStatus: string, age: number): number {
  const phaseout = ROTH_IRA_PHASEOUT[filingStatus] ?? ROTH_IRA_PHASEOUT.single
  const limit = iraLimit(age)
  if (magi <= phaseout.start) return limit
  if (magi >= phaseout.end)   return 0
  const reductionFactor = (magi - phaseout.start) / (phaseout.end - phaseout.start)
  const reduced = Math.floor((limit - Math.round(reductionFactor * limit)) / 10) * 10
  return Math.max(200, reduced)
}
