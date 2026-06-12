import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { loadProfile, holdingMarketValue } from '../profile'

// ---------------------------------------------------------------------------
// check_employer_match
// ---------------------------------------------------------------------------

export const checkEmployerMatch = tool({
  description: `Check whether 401k/403b contributions are set high enough to capture the full employer match.
A missed employer match is a 100% guaranteed return — always the highest-priority optimization.
Returns match available, match being captured, any missed match in dollars, and the minimum
deferral rate needed to capture the full match.`,
  inputSchema: zodSchema(z.object({})),
  execute: async () => {
    const profile = loadProfile()

    const w2Income = profile.income
      ?.filter(i => i.is_w2)
      .reduce((s, i) => s + i.annual_amount, 0) ?? 0

    // Only salary counts toward 401k match (not RSU/bonus at most employers)
    const salaryIncome = profile.income
      ?.filter(i => i.is_w2 && i.source === 'salary')
      .reduce((s, i) => s + i.annual_amount, 0) ?? w2Income

    const matchAccounts = profile.accounts.filter(a => a.employer_match_pct > 0)

    if (!matchAccounts.length) {
      return {
        match_available: false,
        accounts: [],
        total_annual_match_available: 0,
        total_annual_match_captured: 0,
        total_annual_match_missed: 0,
        summary: 'No employer match found in any account.',
      }
    }

    const accounts = matchAccounts.map(account => {
      // Annualize YTD contribution
      const annualizedContrib = profile.current_month > 0
        ? Math.round(account.ytd_contribution * 12 / profile.current_month)
        : account.ytd_contribution

      const matchPct = account.employer_match_pct            // e.g. 0.04 = 4%
      const matchCap = account.employer_match_limit           // max match dollars/year

      // Match is earned on employee contributions up to matchCap / matchPct of salary
      const salaryThresholdForFullMatch = matchCap / matchPct
      const employeeContribForFullMatch = Math.min(salaryThresholdForFullMatch, salaryIncome) * matchPct

      // How much match is the current contribution rate capturing?
      const deferralRate = salaryIncome > 0 ? annualizedContrib / salaryIncome : 0
      const matchCaptured = Math.min(annualizedContrib * matchPct, matchCap)
      const matchAvailable = Math.min(salaryIncome * matchPct, matchCap)
      const matchMissed = Math.max(0, matchAvailable - matchCaptured)

      const minDeferralRateForFullMatch = salaryIncome > 0
        ? parseFloat(((employeeContribForFullMatch / salaryIncome) * 100).toFixed(1))
        : null

      const currentDeferralRatePct = parseFloat((deferralRate * 100).toFixed(1))
      const capturedFullMatch = matchMissed < 1

      return {
        account: account.name,
        institution: account.institution,
        employer_match_pct: parseFloat((matchPct * 100).toFixed(0)),
        employer_match_cap: matchCap,
        annualized_employee_contribution: annualizedContrib,
        current_deferral_rate_pct: currentDeferralRatePct,
        min_deferral_rate_for_full_match_pct: minDeferralRateForFullMatch,
        annual_match_available: Math.round(matchAvailable),
        annual_match_captured: Math.round(matchCaptured),
        annual_match_missed: Math.round(matchMissed),
        capturing_full_match: capturedFullMatch,
        action: capturedFullMatch
          ? 'Full match being captured.'
          : `Increase deferral to ${minDeferralRateForFullMatch}% to capture full match. Missing $${Math.round(matchMissed).toLocaleString()}/yr — a 100% guaranteed return.`,
      }
    })

    const totalMatchAvailable = accounts.reduce((s, a) => s + a.annual_match_available, 0)
    const totalMatchCaptured = accounts.reduce((s, a) => s + a.annual_match_captured, 0)
    const totalMatchMissed = accounts.reduce((s, a) => s + a.annual_match_missed, 0)

    return {
      w2_salary_income: salaryIncome,
      accounts,
      total_annual_match_available: totalMatchAvailable,
      total_annual_match_captured: totalMatchCaptured,
      total_annual_match_missed: totalMatchMissed,
      all_matches_captured: totalMatchMissed < 1,
      summary: totalMatchMissed < 1
        ? `Full employer match captured across all accounts ($${totalMatchAvailable.toLocaleString()}/yr).`
        : `Missing $${Math.round(totalMatchMissed).toLocaleString()}/yr in employer match — the highest-priority fix in the portfolio.`,
    }
  },
})

// ---------------------------------------------------------------------------
// check_roth_eligibility
// ---------------------------------------------------------------------------

// 2025 Roth IRA MAGI phaseout thresholds
const ROTH_PHASEOUT_2025 = {
  single:                  { start: 150000, end: 165000 },
  married_filing_jointly:  { start: 236000, end: 246000 },
  married_filing_separately: { start: 0, end: 10000 },
}

export const checkRothEligibility = tool({
  description: `Check whether the user is eligible to contribute directly to a Roth IRA at their current MAGI.
Flags if they're in the phaseout range or over the limit (requiring backdoor Roth).
Also checks whether existing Roth IRA contributions in the profile may be excess contributions.
Returns eligibility status, allowed contribution amount, and backdoor Roth guidance if needed.`,
  inputSchema: zodSchema(z.object({
    year: z.number().optional().describe('Tax year to check. Defaults to 2025.'),
  })),
  execute: async ({ year = 2025 }) => {
    const profile = loadProfile()

    const magi = profile.tax.estimated_agi  // MAGI ≈ AGI for most W-2 earners
    const filingStatus = profile.tax.filing_status as keyof typeof ROTH_PHASEOUT_2025
    const phaseout = ROTH_PHASEOUT_2025[filingStatus] ?? ROTH_PHASEOUT_2025.single

    const baseLimit = 7000  // 2025 IRA limit
    const primaryMember = profile.household?.find(h => h.is_primary)
    const age = primaryMember?.age ?? null
    const catchupLimit = age !== null && age >= 50 ? baseLimit + 1000 : baseLimit

    // Calculate allowed Roth IRA contribution
    let allowedContribution: number
    let eligibilityStatus: 'full' | 'partial' | 'ineligible'
    let reducedBy = 0

    if (magi <= phaseout.start) {
      allowedContribution = catchupLimit
      eligibilityStatus = 'full'
    } else if (magi >= phaseout.end) {
      allowedContribution = 0
      eligibilityStatus = 'ineligible'
    } else {
      // Prorated reduction
      const phaseoutRange = phaseout.end - phaseout.start
      const reductionFactor = (magi - phaseout.start) / phaseoutRange
      reducedBy = Math.round(reductionFactor * catchupLimit)
      // IRS: round down to nearest $10, minimum $200 if in phaseout
      allowedContribution = Math.max(200, catchupLimit - reducedBy)
      allowedContribution = Math.floor(allowedContribution / 10) * 10
      eligibilityStatus = 'partial'
    }

    // Check existing Roth IRA contributions in profile
    const rothIraAccounts = profile.accounts.filter(
      a => a.tax_treatment === 'tax_free' &&
           a.name.toLowerCase().includes('ira') &&
           a.annual_contribution_limit !== null
    )
    const totalRothIraContrib = rothIraAccounts.reduce((s, a) => s + a.ytd_contribution, 0)
    const excessContribution = Math.max(0, totalRothIraContrib - allowedContribution)

    // Backdoor Roth: check for pre-tax IRA balances (pro-rata rule)
    const traditionalIraAccounts = profile.accounts.filter(
      a => a.tax_treatment === 'tax_deferred' && a.name.toLowerCase().includes('ira')
    )
    const traditionalIraBalance = traditionalIraAccounts.reduce((s, a) => s + a.balance, 0)
    const proRataIssue = traditionalIraBalance > 0 && eligibilityStatus === 'ineligible'

    return {
      year,
      magi,
      filing_status: filingStatus,
      phaseout_range: { start: phaseout.start, end: phaseout.end },
      eligibility_status: eligibilityStatus,
      annual_roth_ira_limit: catchupLimit,
      allowed_direct_contribution: allowedContribution,
      existing_roth_ira_contributions: totalRothIraContrib,
      excess_contribution: excessContribution,
      excess_contribution_flag: excessContribution > 0,
      backdoor_roth: {
        required: eligibilityStatus === 'ineligible',
        recommended: eligibilityStatus === 'partial',
        pro_rata_issue: proRataIssue,
        traditional_ira_balance: traditionalIraBalance,
        pro_rata_note: proRataIssue
          ? `You have $${traditionalIraBalance.toLocaleString()} in pre-tax Traditional IRA. The pro-rata rule means a backdoor Roth conversion will be partially taxable. Consider rolling the Traditional IRA into your 401k first if the plan accepts rollovers.`
          : traditionalIraBalance === 0
            ? 'No pre-tax Traditional IRA balance — backdoor Roth is clean with no pro-rata complications.'
            : null,
        steps: eligibilityStatus !== 'full' ? [
          '1. Contribute $7,000 to a Traditional IRA (non-deductible — file Form 8606).',
          '2. Convert the Traditional IRA to Roth IRA immediately (minimize growth to reduce taxable amount).',
          '3. Ensure no other pre-tax IRA balances exist to avoid pro-rata taxation.',
        ] : null,
      },
      summary: eligibilityStatus === 'full'
        ? `Eligible for full $${catchupLimit.toLocaleString()} Roth IRA contribution at $${magi.toLocaleString()} MAGI.`
        : eligibilityStatus === 'partial'
          ? `Partial Roth IRA eligibility — can contribute $${allowedContribution.toLocaleString()} directly. Consider backdoor Roth for the remainder.`
          : `Over Roth IRA income limit ($${phaseout.end.toLocaleString()}) at $${magi.toLocaleString()} MAGI. Direct contribution not allowed.${excessContribution > 0 ? ` Excess contribution of $${excessContribution.toLocaleString()} detected — must be withdrawn or recharacterized to avoid 6% annual penalty.` : ' Use backdoor Roth instead.'}`,
    }
  },
})

// ---------------------------------------------------------------------------
// analyze_asset_class_allocation
// ---------------------------------------------------------------------------

// Broad asset class groupings for portfolio-level analysis
const EQUITY_CLASSES = new Set(['us_equity_large', 'us_equity_small', 'intl_equity_developed', 'intl_equity_emerging', 'reits'])
const BOND_CLASSES = new Set(['us_bonds', 'intl_bonds', 'tips'])
const ALTERNATIVE_CLASSES = new Set(['commodities', 'crypto'])
const CASH_CLASSES = new Set(['cash_equivalent'])

// Target equity allocation by risk tolerance and years to retirement
function targetEquityPct(riskTolerance: string, yearsToRetirement: number): number {
  const baseByRisk: Record<string, number> = {
    conservative: 40,
    moderate: 60,
    aggressive: 80,
    'very aggressive': 90,
  }
  const base = baseByRisk[riskTolerance.toLowerCase()] ?? 70

  // Glide path: reduce equity 1pp per year inside 15 years of retirement
  if (yearsToRetirement < 15) {
    return Math.max(base - (15 - yearsToRetirement) * 1.5, 30)
  }
  return base
}

export const analyzeAssetClassAllocation = tool({
  description: `Analyze the portfolio's broad asset class allocation (equity, bonds, alternatives, cash)
vs the recommended target for the user's age, risk tolerance, and retirement timeline.
Returns current vs target allocation, drift by category, and specific rebalancing guidance.
This is portfolio-level — for account-level drift use suggest_rebalancing.`,
  inputSchema: zodSchema(z.object({
    custom_equity_target_pct: z.number().optional().describe('Override the computed equity target. Use when user specifies a target allocation.'),
  })),
  execute: async ({ custom_equity_target_pct }) => {
    const profile = loadProfile()

    const primaryMember = profile.household?.find(h => h.is_primary)
    const age = primaryMember?.age ?? 35
    const retirementAge = primaryMember?.retirement_age ?? 65
    const yearsToRetirement = Math.max(0, retirementAge - age)
    const riskTolerance = profile.risk_tolerance ?? 'moderate'

    // Compute current allocation by broad category
    let totalPortfolio = 0
    const categoryValues: Record<string, number> = { equity: 0, bonds: 0, alternatives: 0, cash_equivalent: 0 }
    const byAssetClass: Record<string, number> = {}

    for (const account of profile.accounts) {
      if (account.tax_treatment === 'cash') {
        // Savings/checking/HYSA → cash, not portfolio
        continue
      }
      for (const h of account.holdings) {
        const val = holdingMarketValue(h)
        totalPortfolio += val
        byAssetClass[h.asset_class] = (byAssetClass[h.asset_class] ?? 0) + val

        if (EQUITY_CLASSES.has(h.asset_class)) categoryValues.equity += val
        else if (BOND_CLASSES.has(h.asset_class)) categoryValues.bonds += val
        else if (ALTERNATIVE_CLASSES.has(h.asset_class)) categoryValues.alternatives += val
        else if (CASH_CLASSES.has(h.asset_class)) categoryValues.cash_equivalent += val
      }
      // If account has no holdings recorded, use balance
      if (account.holdings.length === 0) {
        totalPortfolio += account.balance
        categoryValues.equity += account.balance  // assume equity if unspecified
      }
    }

    // Also sum account balances as a cross-check
    const accountBalanceTotal = profile.accounts
      .filter(a => a.tax_treatment !== 'cash')
      .reduce((s, a) => s + a.balance, 0)

    // Use whichever is larger (catches unrecorded holdings)
    const effectiveTotal = Math.max(totalPortfolio, accountBalanceTotal * 0.8)

    const computedEquityTarget = targetEquityPct(riskTolerance, yearsToRetirement)
    const equityTargetPct = custom_equity_target_pct ?? computedEquityTarget

    // Derive bond/alt/cash targets from equity target
    // Simple model: remaining split 80% bonds, 15% alternatives, 5% cash equivalent
    const remainingPct = 100 - equityTargetPct
    const bondTargetPct = Math.round(remainingPct * 0.80)
    const altTargetPct = Math.round(remainingPct * 0.15)
    const cashEqTargetPct = remainingPct - bondTargetPct - altTargetPct

    const currentPcts = {
      equity: effectiveTotal > 0 ? parseFloat((categoryValues.equity / effectiveTotal * 100).toFixed(1)) : 0,
      bonds: effectiveTotal > 0 ? parseFloat((categoryValues.bonds / effectiveTotal * 100).toFixed(1)) : 0,
      alternatives: effectiveTotal > 0 ? parseFloat((categoryValues.alternatives / effectiveTotal * 100).toFixed(1)) : 0,
      cash_equivalent: effectiveTotal > 0 ? parseFloat((categoryValues.cash_equivalent / effectiveTotal * 100).toFixed(1)) : 0,
    }

    const targets = {
      equity: equityTargetPct,
      bonds: bondTargetPct,
      alternatives: altTargetPct,
      cash_equivalent: cashEqTargetPct,
    }

    type Category = keyof typeof currentPcts

    const categories: Category[] = ['equity', 'bonds', 'alternatives', 'cash_equivalent']
    const driftAnalysis = categories.map(cat => {
      const current = currentPcts[cat]
      const target = targets[cat]
      const drift = parseFloat((current - target).toFixed(1))
      const dollarDrift = Math.round(Math.abs(drift / 100) * effectiveTotal)
      const severity: 'on_target' | 'minor' | 'moderate' | 'significant' =
        Math.abs(drift) < 3 ? 'on_target'
        : Math.abs(drift) < 7 ? 'minor'
        : Math.abs(drift) < 15 ? 'moderate'
        : 'significant'

      return {
        category: cat,
        current_pct: current,
        target_pct: target,
        drift_pct: drift,
        dollar_drift: dollarDrift,
        direction: drift > 0 ? 'over' as const : drift < 0 ? 'under' as const : 'on_target' as const,
        severity,
      }
    })

    // Granular asset class breakdown
    const assetClassBreakdown = Object.entries(byAssetClass)
      .map(([ac, val]) => ({
        asset_class: ac,
        value: Math.round(val),
        allocation_pct: parseFloat((val / effectiveTotal * 100).toFixed(1)),
      }))
      .sort((a, b) => b.value - a.value)

    // US vs International equity split
    const usEquity = (byAssetClass['us_equity_large'] ?? 0) + (byAssetClass['us_equity_small'] ?? 0)
    const intlEquity = (byAssetClass['intl_equity_developed'] ?? 0) + (byAssetClass['intl_equity_emerging'] ?? 0)
    const totalEquity = categoryValues.equity
    const usIntlSplit = totalEquity > 0 ? {
      us_pct: parseFloat((usEquity / totalEquity * 100).toFixed(1)),
      international_pct: parseFloat((intlEquity / totalEquity * 100).toFixed(1)),
      recommended_us_pct: 60,
      recommended_intl_pct: 40,
      note: usEquity / totalEquity > 0.80
        ? 'Equity is heavily US-concentrated (>80%). Consider increasing international exposure.'
        : 'US/international equity split is reasonable.',
    } : null

    // Generate rebalancing actions
    const actions: string[] = []
    for (const d of driftAnalysis) {
      if (d.severity === 'on_target') continue
      if (d.direction === 'over') {
        actions.push(`Reduce ${d.category} by ${Math.abs(d.drift_pct)}pp (~$${d.dollar_drift.toLocaleString()}) — redirect new contributions away from ${d.category} assets.`)
      } else {
        actions.push(`Increase ${d.category} by ${Math.abs(d.drift_pct)}pp (~$${d.dollar_drift.toLocaleString()}) — direct new contributions toward ${d.category} assets.`)
      }
    }

    const significantDrift = driftAnalysis.filter(d => d.severity === 'moderate' || d.severity === 'significant')

    return {
      total_invested_portfolio: Math.round(effectiveTotal),
      age,
      years_to_retirement: yearsToRetirement,
      risk_tolerance: riskTolerance,
      target_basis: custom_equity_target_pct
        ? 'user-specified'
        : `computed for ${riskTolerance} risk tolerance, ${yearsToRetirement} years to retirement`,
      current_allocation: currentPcts,
      target_allocation: targets,
      drift_analysis: driftAnalysis,
      asset_class_breakdown: assetClassBreakdown,
      us_international_equity_split: usIntlSplit,
      rebalancing_actions: actions,
      rebalancing_needed: significantDrift.length > 0,
      summary: significantDrift.length === 0
        ? `Portfolio allocation is close to target for ${riskTolerance} risk tolerance (${equityTargetPct}% equity target). Minor drift only.`
        : `${significantDrift.length} significant allocation drift(s): ${significantDrift.map(d => `${d.category} ${d.direction} by ${Math.abs(d.drift_pct)}pp`).join(', ')}. Target: ${equityTargetPct}% equity for ${riskTolerance} risk, ${yearsToRetirement} years to retirement.`,
    }
  },
})
