import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { loadProfile, holdingMarketValue } from '../profile'

/**
 * Compound growth: FV of lump sum + FV of annual contributions (end-of-year)
 */
function projectPortfolio(currentValue: number, annualContribution: number, annualReturn: number, years: number): number {
  const r = annualReturn
  const fvLump = currentValue * Math.pow(1 + r, years)
  const fvContribs = annualContribution * ((Math.pow(1 + r, years) - 1) / r)
  return fvLump + fvContribs
}

/**
 * How many years until a target is reached given current value + annual contribution.
 * Returns null if it never converges (e.g. annual contribution alone exceeds target growth).
 */
function yearsToTarget(currentValue: number, annualContribution: number, annualReturn: number, target: number): number | null {
  if (currentValue >= target) return 0
  // Solve FV = target numerically (max 100 years)
  for (let y = 1; y <= 100; y++) {
    if (projectPortfolio(currentValue, annualContribution, annualReturn, y) >= target) return y
  }
  return null
}

export const projectRetirement = tool({
  description: `Project retirement / FIRE timeline and gap analysis. Calculates when the user hits their
retirement target given current savings, contribution rate, and expected returns. Returns year-by-year
milestones, required savings rate adjustments, and sensitivity to return assumptions.`,
  inputSchema: zodSchema(z.object({
    annual_return_pct: z.number().optional().describe('Expected annual portfolio return %. Defaults to 7.0.'),
    inflation_pct: z.number().optional().describe('Inflation rate % for real-return calculation. Defaults to 3.0.'),
    withdrawal_rate_pct: z.number().optional().describe('Safe withdrawal rate % for reverse-engineering target. Defaults to 4.0.'),
    target_annual_spend: z.number().optional().describe('Target annual spending in retirement (today\'s dollars). If provided, overrides goal target_amount.'),
  })),
  execute: async ({ annual_return_pct = 7.0, inflation_pct = 3.0, withdrawal_rate_pct = 4.0, target_annual_spend }) => {
    const profile = loadProfile()
    const now = new Date()
    const currentYear = profile.current_year || now.getFullYear()

    // Current invested portfolio (exclude cash)
    let currentPortfolio = 0
    for (const account of profile.accounts) {
      if (account.tax_treatment === 'cash') continue
      for (const h of account.holdings) currentPortfolio += holdingMarketValue(h)
      // If no holdings recorded, fall back to account balance
      if (account.holdings.length === 0) currentPortfolio += account.balance
    }
    // Use account balances if holdings sum is way off
    const balanceSum = profile.accounts.filter(a => a.tax_treatment !== 'cash').reduce((s, a) => s + a.balance, 0)
    if (currentPortfolio < balanceSum * 0.5) currentPortfolio = balanceSum

    const annualContribution = profile.total_annual_investable ?? 0
    const nominalReturn = annual_return_pct / 100
    const realReturn = (1 + nominalReturn) / (1 + inflation_pct / 100) - 1

    // Find the FIRE goal
    const fireGoal = profile.goals?.find(g => g.name.toLowerCase().includes('retire') || g.name.toLowerCase().includes('fire'))
    const targetAmount = target_annual_spend
      ? Math.round(target_annual_spend / (withdrawal_rate_pct / 100))
      : fireGoal?.target_amount ?? Math.round((profile.total_annual_investable ?? 100000) * 25)

    const targetDate = fireGoal?.target_date ? new Date(fireGoal.target_date) : null
    const targetYear = targetDate ? targetDate.getFullYear() : null
    const yearsToTargetDate = targetYear ? targetYear - currentYear : null

    // Primary projection: nominal returns
    const yearsNominal = yearsToTarget(currentPortfolio, annualContribution, nominalReturn, targetAmount)
    const yearsReal = yearsToTarget(currentPortfolio, annualContribution, realReturn, targetAmount)

    // Value at target date (if goal has a date)
    const valueAtTargetDate = yearsToTargetDate !== null && yearsToTargetDate > 0
      ? Math.round(projectPortfolio(currentPortfolio, annualContribution, nominalReturn, yearsToTargetDate))
      : null

    const onTrackForTargetDate = valueAtTargetDate !== null ? valueAtTargetDate >= targetAmount : null
    const gapAtTargetDate = valueAtTargetDate !== null ? valueAtTargetDate - targetAmount : null

    // Required annual contribution to hit target by target date
    let requiredAnnualContribution: number | null = null
    if (yearsToTargetDate !== null && yearsToTargetDate > 0) {
      const fvLump = currentPortfolio * Math.pow(1 + nominalReturn, yearsToTargetDate)
      const fvFactor = (Math.pow(1 + nominalReturn, yearsToTargetDate) - 1) / nominalReturn
      requiredAnnualContribution = fvFactor > 0 ? Math.round((targetAmount - fvLump) / fvFactor) : null
    }

    // Sensitivity: what if returns are 1% lower or higher?
    const yearsLowReturn = yearsToTarget(currentPortfolio, annualContribution, nominalReturn - 0.01, targetAmount)
    const yearsHighReturn = yearsToTarget(currentPortfolio, annualContribution, nominalReturn + 0.01, targetAmount)

    // 10-year milestones
    const milestones: { year: number; projected_value: number; pct_of_target: number }[] = []
    for (let y = 5; y <= Math.max(40, (yearsNominal ?? 40) + 5); y += 5) {
      const val = Math.round(projectPortfolio(currentPortfolio, annualContribution, nominalReturn, y))
      milestones.push({
        year: currentYear + y,
        projected_value: val,
        pct_of_target: parseFloat((val / targetAmount * 100).toFixed(1)),
      })
      if (val >= targetAmount * 1.5) break
    }

    // Primary member age context
    const primaryMember = profile.household?.find(h => h.is_primary)
    const currentAge = primaryMember?.age ?? null
    const retirementAge = primaryMember?.retirement_age ?? null
    const fireYear = yearsNominal !== null ? currentYear + yearsNominal : null
    const fireAge = currentAge !== null && yearsNominal !== null ? currentAge + yearsNominal : null

    return {
      current_portfolio: Math.round(currentPortfolio),
      annual_contribution: annualContribution,
      target_amount: targetAmount,
      withdrawal_rate_pct,
      assumptions: {
        nominal_return_pct: annual_return_pct,
        real_return_pct: parseFloat((realReturn * 100).toFixed(2)),
        inflation_pct,
      },
      projection: {
        years_to_fire_nominal: yearsNominal,
        years_to_fire_real: yearsReal,
        fire_year_nominal: fireYear,
        fire_age_nominal: fireAge,
      },
      goal: fireGoal ? {
        name: fireGoal.name,
        target_year: targetYear,
        years_remaining: yearsToTargetDate,
        value_at_target_date: valueAtTargetDate,
        gap_at_target_date: gapAtTargetDate,
        on_track: onTrackForTargetDate,
        required_annual_contribution: requiredAnnualContribution,
        shortfall_per_year: requiredAnnualContribution !== null
          ? Math.max(0, requiredAnnualContribution - annualContribution)
          : null,
      } : null,
      sensitivity: {
        at_6pct_return: { years_to_fire: yearsLowReturn, fire_year: yearsLowReturn !== null ? currentYear + yearsLowReturn : null },
        at_7pct_return: { years_to_fire: yearsNominal, fire_year: fireYear },
        at_8pct_return: { years_to_fire: yearsHighReturn, fire_year: yearsHighReturn !== null ? currentYear + yearsHighReturn : null },
      },
      milestones,
      current_age: currentAge,
      target_retirement_age: retirementAge,
      summary: yearsNominal !== null
        ? `At ${annual_return_pct}% returns and $${annualContribution.toLocaleString()}/yr contributions, projected FIRE in ${yearsNominal} years (${fireYear}${fireAge ? `, age ${fireAge}` : ''}). Target: $${targetAmount.toLocaleString()}.${onTrackForTargetDate === false && gapAtTargetDate ? ` Gap at target date: $${Math.abs(gapAtTargetDate).toLocaleString()}.` : onTrackForTargetDate ? ' On track for target date.' : ''}`
        : `Cannot reach $${targetAmount.toLocaleString()} target within 100 years at current contribution rate and ${annual_return_pct}% returns.`,
    }
  },
})

export const analyzeGoalFunding = tool({
  description: `Analyze how well current savings are funded across all financial goals. Identifies conflicts between
competing goals, which goals are underfunded, and the tradeoff of redirecting money between them.`,
  inputSchema: zodSchema(z.object({
    annual_return_pct: z.number().optional().describe('Expected annual return % for projections. Defaults to 7.0 for long-term, 4.0 for short-term (<3yr) goals.'),
  })),
  execute: async ({ annual_return_pct = 7.0 }) => {
    const profile = loadProfile()
    const now = new Date()
    const currentYear = profile.current_year || now.getFullYear()

    const goals = profile.goals ?? []
    if (!goals.length) return {
      goals: [],
      conflicts: [],
      total_monthly_needed: 0,
      total_monthly_available: Math.round((profile.total_annual_investable ?? 0) / 12),
      summary: 'No goals found in profile.',
    }

    const totalMonthlyAvailable = Math.round((profile.total_annual_investable ?? 0) / 12)

    const analyzedGoals = goals.map(goal => {
      const targetDate = new Date(goal.target_date)
      const yearsRemaining = Math.max(0, (targetDate.getTime() - now.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
      const monthsRemaining = Math.round(yearsRemaining * 12)

      // Use conservative return for short-term goals
      const returnRate = yearsRemaining < 3 ? 0.04 : annual_return_pct / 100

      const gap = goal.target_amount - goal.current_progress
      const monthlyContrib = goal.monthly_contribution ?? 0

      // Project current progress + monthly contributions to target date
      const projectedValue = yearsRemaining > 0
        ? projectPortfolio(goal.current_progress, monthlyContrib * 12, returnRate, yearsRemaining)
        : goal.current_progress
      const projectedGap = goal.target_amount - projectedValue
      const onTrack = projectedGap <= 0

      // Required monthly to close gap (simple: spread remaining gap over months)
      // FV = PV*(1+r)^n + PMT*((1+r)^n-1)/r → solve for PMT
      let requiredMonthly: number | null = null
      if (monthsRemaining > 0 && gap > 0) {
        const monthlyRate = returnRate / 12
        const n = monthsRemaining
        const fvLump = goal.current_progress * Math.pow(1 + monthlyRate, n)
        const fvFactor = monthlyRate > 0 ? (Math.pow(1 + monthlyRate, n) - 1) / monthlyRate : n
        requiredMonthly = fvFactor > 0 ? Math.round((goal.target_amount - fvLump) / fvFactor) : Math.round(gap / n)
      }

      const monthlyShortfall = requiredMonthly !== null
        ? Math.max(0, requiredMonthly - monthlyContrib)
        : null

      return {
        name: goal.name,
        priority: goal.priority,
        target_amount: goal.target_amount,
        current_progress: goal.current_progress,
        gap: Math.round(gap),
        target_date: goal.target_date,
        years_remaining: parseFloat(yearsRemaining.toFixed(1)),
        months_remaining: monthsRemaining,
        monthly_contribution: monthlyContrib,
        required_monthly: requiredMonthly,
        monthly_shortfall: monthlyShortfall,
        projected_value_at_target: Math.round(projectedValue),
        projected_gap: Math.round(projectedGap),
        on_track: onTrack,
        return_rate_used_pct: parseFloat((returnRate * 100).toFixed(1)),
        progress_pct: parseFloat((goal.current_progress / goal.target_amount * 100).toFixed(1)),
      }
    }).sort((a, b) => a.priority - b.priority)

    const totalMonthlyNeeded = analyzedGoals.reduce((s, g) => s + (g.required_monthly ?? 0), 0)
    const monthlyDeficit = Math.max(0, totalMonthlyNeeded - totalMonthlyAvailable)

    // Identify conflicts: goals competing for the same dollars
    const conflicts: { description: string; tradeoff: string }[] = []
    if (monthlyDeficit > 0) {
      conflicts.push({
        description: `Total required monthly ($${totalMonthlyNeeded.toLocaleString()}) exceeds available ($${totalMonthlyAvailable.toLocaleString()}) by $${monthlyDeficit.toLocaleString()}/mo.`,
        tradeoff: `Prioritize by goal priority order. Each $${Math.round(monthlyDeficit / analyzedGoals.length).toLocaleString()}/mo redirected from a lower-priority goal closes the gap on a higher one.`,
      })
    }

    const shortTermGoals = analyzedGoals.filter(g => g.years_remaining < 3 && !g.on_track)
    const longTermGoals = analyzedGoals.filter(g => g.years_remaining >= 3 && !g.on_track)
    if (shortTermGoals.length && longTermGoals.length) {
      conflicts.push({
        description: `Short-term goals (${shortTermGoals.map(g => g.name).join(', ')}) need liquid, low-risk money that can't be invested for long-term returns.`,
        tradeoff: 'Keep short-term goal funds in HYSA/money market — don\'t expose them to equity risk to chase returns.',
      })
    }

    return {
      goals: analyzedGoals,
      conflicts,
      total_monthly_available: totalMonthlyAvailable,
      total_monthly_needed: Math.round(totalMonthlyNeeded),
      monthly_deficit: Math.round(monthlyDeficit),
      all_goals_funded: monthlyDeficit === 0,
      summary: analyzedGoals.length === 0
        ? 'No goals to analyze.'
        : `${analyzedGoals.filter(g => g.on_track).length}/${analyzedGoals.length} goals on track. Monthly needed: $${Math.round(totalMonthlyNeeded).toLocaleString()} vs $${totalMonthlyAvailable.toLocaleString()} available.${monthlyDeficit > 0 ? ` Deficit: $${Math.round(monthlyDeficit).toLocaleString()}/mo.` : ''}`,
    }
  },
})
