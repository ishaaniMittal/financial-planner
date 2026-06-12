import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { loadProfile, holdingMarketValue } from '../profile'
import {
  CONTRIBUTION_LIMITS, TAX_YEAR,
  federalTaxOwed, federalMarginalRate,
  tentativeMinimumTax, federalTaxOwed as regTax,
  ANNUAL_GIFT_EXCLUSION, MAX_529_SUPERFUNDING, SUPERFUNDING_YEARS,
  HSA_LIMIT_INDIVIDUAL, HSA_LIMIT_FAMILY, HSA_CATCHUP_55,
  getStateRate,
} from '../tax-data'

// ---------------------------------------------------------------------------
// analyze_mega_backdoor_roth
// ---------------------------------------------------------------------------

export const analyzeMegaBackdoorRoth = tool({
  description: `Check whether the user's 401(k) plan allows a Mega Backdoor Roth strategy
(after-tax contributions + in-plan Roth conversion or in-service withdrawal).
Calculates how much additional Roth space is available beyond the $23,500 employee limit,
up to the $70,000 IRS 415(c) combined limit. Shows YTD utilization and remaining capacity.`,
  inputSchema: zodSchema(z.object({
    age: z.number().optional().describe('Member age. Defaults to primary household member.'),
  })),
  execute: async ({ age }) => {
    const profile = loadProfile()
    const primary = profile.household?.find(h => h.is_primary)
    const memberAge = age ?? primary?.age ?? 30

    const benefits = profile.benefits ?? {}

    if (!benefits.has_mega_backdoor_roth) {
      return {
        eligible: false,
        reason: 'Profile does not indicate that the 401(k) plan allows after-tax contributions. Confirm with your plan documents or HR whether the plan supports after-tax (non-Roth) contributions with in-plan Roth conversion.',
        action: 'Ask HR: (1) Does the plan allow after-tax (non-Roth) contributions? (2) Is in-plan Roth conversion or in-service withdrawal available?',
      }
    }

    const employeeElective = CONTRIBUTION_LIMITS.k401  // 23,500 base
    const catchup = memberAge >= 60 && memberAge <= 63
      ? CONTRIBUTION_LIMITS.k401_catchup_60
      : memberAge >= 50
        ? CONTRIBUTION_LIMITS.k401_catchup_50
        : 0
    const employeeElectiveWithCatchup = employeeElective + catchup

    // 401k account from profile
    const k401Account = profile.accounts.find(a =>
      a.name.toLowerCase().includes('401') || a.id.toLowerCase().includes('401')
    )
    const ytdElective = k401Account?.ytd_contribution ?? 0
    const employerMatch = k401Account?.employer_match_pct
      ? profile.income?.reduce((s, i) => s + i.annual_amount, 0) ?? 0
      : 0

    // Estimate employer contributions: match + any profit sharing
    const estimatedEmployerContrib = k401Account
      ? Math.min(
          (k401Account.employer_match_pct ?? 0) * (profile.income?.[0]?.annual_amount ?? 0),
          k401Account.employer_match_limit ?? Infinity
        )
      : 0

    const totalLimit = CONTRIBUTION_LIMITS.k401_total_limit  // 70,000
    const afterTaxYtd = benefits.after_tax_401k_ytd ?? 0

    // Space remaining for after-tax contributions
    const usedCapacity = ytdElective + estimatedEmployerContrib + afterTaxYtd
    const remainingCapacity = Math.max(0, totalLimit - usedCapacity)

    // Full-year projection
    const currentMonth = profile.current_month
    const monthsLeft = 12 - currentMonth
    const projectedElective = currentMonth > 0 ? (ytdElective / currentMonth) * 12 : ytdElective
    const projectedAfterTax = currentMonth > 0 ? (afterTaxYtd / currentMonth) * 12 : afterTaxYtd
    const projectedEmployer = estimatedEmployerContrib  // annual
    const projectedTotal = projectedElective + projectedAfterTax + projectedEmployer
    const projectedAfterTaxCapacity = Math.max(0, totalLimit - projectedElective - projectedEmployer)

    // Tax benefit: after-tax contributions convert to Roth tax-free
    // The benefit is tax-free growth vs taxable account
    const stateRate = getStateRate(profile.tax.state)
    const marginalRate = profile.tax.marginal_federal_rate + stateRate
    const annualTaxDragSaved = remainingCapacity * marginalRate * 0.05  // rough: 5% return × rate

    return {
      eligible: true,
      plan_supports_after_tax: true,
      employee_elective_limit: employeeElectiveWithCatchup,
      ytd_elective: ytdElective,
      estimated_annual_employer: Math.round(estimatedEmployerContrib),
      after_tax_ytd: afterTaxYtd,
      irs_415c_total_limit: totalLimit,
      after_tax_capacity_remaining: Math.round(remainingCapacity),
      projected_full_year: {
        elective: Math.round(projectedElective),
        employer: Math.round(projectedEmployer),
        after_tax_available: Math.round(projectedAfterTaxCapacity),
        total_projected: Math.round(projectedTotal),
        within_limit: projectedTotal <= totalLimit,
      },
      months_left: monthsLeft,
      monthly_after_tax_to_maximize: monthsLeft > 0
        ? Math.round(remainingCapacity / monthsLeft)
        : 0,
      tax_benefit_note: `After-tax contributions convert to Roth tax-free. Estimated annual tax-drag avoided vs taxable account: ~$${Math.round(annualTaxDragSaved).toLocaleString()} at ${(marginalRate * 100).toFixed(0)}% combined rate.`,
      how_it_works: 'Contribute after-tax dollars beyond the $23,500 employee limit. Immediately convert to Roth inside the plan (in-plan conversion) or roll out to a Roth IRA (in-service withdrawal if plan allows). Earnings between contribution and conversion are taxable — convert promptly to minimize this.',
      summary: `Plan supports Mega Backdoor Roth. After-tax capacity remaining this year: $${Math.round(remainingCapacity).toLocaleString()} (~$${monthsLeft > 0 ? Math.round(remainingCapacity / monthsLeft).toLocaleString() : 0}/mo). Full-year after-tax slot: $${Math.round(projectedAfterTaxCapacity).toLocaleString()}.`,
    }
  },
})

// ---------------------------------------------------------------------------
// compare_health_plans
// ---------------------------------------------------------------------------

export const compareHealthPlans = tool({
  description: `Compare HDHP vs PPO (or any two health plans) on a break-even basis.
Calculates the premium difference, deductible/OOP max gap, and HSA tax savings.
Identifies which plan wins at low, medium, and high utilization levels.
Uses profile benefits data when available; accepts override parameters.`,
  inputSchema: zodSchema(z.object({
    hdhp_monthly_premium: z.number().optional().describe('HDHP monthly premium (employee share). Reads from profile if omitted.'),
    hdhp_deductible: z.number().optional().describe('HDHP annual deductible.'),
    hdhp_oop_max: z.number().optional().describe('HDHP annual out-of-pocket maximum.'),
    ppo_monthly_premium: z.number().optional().describe('PPO monthly premium (employee share).'),
    ppo_deductible: z.number().optional().describe('PPO annual deductible.'),
    ppo_oop_max: z.number().optional().describe('PPO annual out-of-pocket maximum.'),
    coverage_type: z.enum(['individual', 'family']).optional().describe('Individual or family coverage. Defaults to family if dependents exist.'),
    employer_hsa_contribution: z.number().optional().describe('Annual employer HSA contribution. Reads from profile if omitted.'),
  })),
  execute: async ({
    hdhp_monthly_premium,
    hdhp_deductible,
    hdhp_oop_max,
    ppo_monthly_premium,
    ppo_deductible,
    ppo_oop_max,
    coverage_type,
    employer_hsa_contribution,
  }) => {
    const profile = loadProfile()
    const benefits = profile.benefits ?? {}
    const primary = profile.household?.find(h => h.is_primary)
    const hasFamily = (profile.dependents?.length ?? 0) > 0

    // Resolve plan parameters
    const hdhpPremiumMonthly = hdhp_monthly_premium ?? benefits.health_plan_monthly_premium ?? 200
    const hdhpDeductible = hdhp_deductible ?? benefits.health_plan_deductible ?? 3000
    const hdhpOopMax = hdhp_oop_max ?? benefits.health_plan_oop_max ?? 6000

    // PPO defaults — if not provided, model a typical PPO comparison
    const ppoPremiumMonthly = ppo_monthly_premium ?? (hdhpPremiumMonthly + 200)
    const ppoDeductible = ppo_deductible ?? 500
    const ppoOopMax = ppo_oop_max ?? 3000

    const coverageType = coverage_type ?? (hasFamily ? 'family' : 'individual')
    const hsaLimit = coverageType === 'family' ? HSA_LIMIT_FAMILY : HSA_LIMIT_INDIVIDUAL
    const employerHsa = employer_hsa_contribution ?? benefits.employer_hsa_contribution ?? 0

    // Annual premiums
    const hdhpAnnualPremium = hdhpPremiumMonthly * 12
    const ppoAnnualPremium = ppoPremiumMonthly * 12
    const premiumSavingsHDHP = ppoAnnualPremium - hdhpAnnualPremium

    // HSA tax benefit (employee contributions to HSA reduce AGI)
    const marginalRate = profile.tax.marginal_federal_rate
    const stateRate = getStateRate(profile.tax.state)
    const combinedRate = marginalRate + stateRate
    const hsaEmployeeContrib = Math.max(0, hsaLimit - employerHsa)
    const hsaTaxSavings = hsaEmployeeContrib * combinedRate
    const totalHdhpAdvantage = premiumSavingsHDHP + hsaTaxSavings + employerHsa

    // Break-even analysis: at what medical spend does HDHP lose vs PPO?
    // HDHP total cost = premium + min(medical_spend, hdhp_deductible) up to oop_max
    // PPO total cost  = premium + min(medical_spend * coinsurance, ppo_oop_max)
    // Simplified: assume 20% coinsurance after PPO deductible
    const coinsurance = 0.20

    const scenarios = [
      { label: 'Healthy (minimal care)', annual_medical: 500 },
      { label: 'Moderate (1-2 issues)', annual_medical: 3000 },
      { label: 'High (chronic/surgery)', annual_medical: hdhpOopMax },
    ]

    const breakdownByScenario = scenarios.map(s => {
      const m = s.annual_medical
      const hdhpOopCost = Math.min(m, hdhpOopMax)
      const ppoOopCost = m <= ppoDeductible
        ? m
        : ppoDeductible + Math.min((m - ppoDeductible) * coinsurance, ppoOopMax - ppoDeductible)

      const hdhpTotal = hdhpAnnualPremium + hdhpOopCost - hsaTaxSavings - employerHsa
      const ppoTotal = ppoAnnualPremium + ppoOopCost

      return {
        scenario: s.label,
        annual_medical_spend: m,
        hdhp_total_cost: Math.round(hdhpTotal),
        ppo_total_cost: Math.round(ppoTotal),
        winner: hdhpTotal < ppoTotal ? 'HDHP' : 'PPO',
        savings_with_winner: Math.round(Math.abs(hdhpTotal - ppoTotal)),
      }
    })

    // Breakeven medical spend
    // hdhpPremium + spend - hsaSavings - employerHsa = ppoPremium + spend * coinsurance (approx for spend > ppoDeductible)
    // Simplified linear approximation
    const breakevenMedical = premiumSavingsHDHP + hsaTaxSavings + employerHsa  // HDHP loses when OOP exceeds this

    return {
      plans: {
        hdhp: {
          monthly_premium: hdhpPremiumMonthly,
          annual_premium: hdhpAnnualPremium,
          deductible: hdhpDeductible,
          oop_max: hdhpOopMax,
          hsa_eligible: true,
        },
        ppo: {
          monthly_premium: ppoPremiumMonthly,
          annual_premium: ppoAnnualPremium,
          deductible: ppoDeductible,
          oop_max: ppoOopMax,
          hsa_eligible: false,
        },
      },
      hdhp_advantages: {
        premium_savings_vs_ppo: Math.round(premiumSavingsHDHP),
        hsa_contribution_room: hsaLimit,
        employer_hsa_contribution: employerHsa,
        hsa_employee_max: hsaEmployeeContrib,
        hsa_tax_savings: Math.round(hsaTaxSavings),
        combined_hdhp_advantage: Math.round(totalHdhpAdvantage),
        coverage_type: coverageType,
        marginal_rate_used: parseFloat((combinedRate * 100).toFixed(1)),
      },
      breakeven_oop_spend: Math.round(breakevenMedical),
      breakeven_note: `HDHP wins if your annual medical spend stays below ~$${Math.round(breakevenMedical).toLocaleString()}. Above that threshold, the PPO's lower OOP max offsets its higher premium.`,
      scenarios: breakdownByScenario,
      current_plan: benefits.health_plan_type ?? 'unknown',
      recommendation: totalHdhpAdvantage > 1000
        ? `HDHP + maxing HSA ($${hsaLimit.toLocaleString()}) saves ~$${Math.round(totalHdhpAdvantage).toLocaleString()}/yr vs PPO at low-to-moderate medical spend. HSA contributions are triple tax-advantaged (deductible, grows tax-free, withdrawals tax-free for medical).`
        : 'Plans are close — choose based on expected medical utilization and risk tolerance.',
      hsa_triple_tax_note: 'HSA is the only triple-tax-advantaged account: (1) contributions reduce AGI, (2) growth is tax-free, (3) qualified medical withdrawals are tax-free. Unused funds roll over indefinitely — invest for retirement healthcare costs.',
    }
  },
})

// ---------------------------------------------------------------------------
// plan_stock_options
// ---------------------------------------------------------------------------

export const planStockOptions = tool({
  description: `Analyze stock options (ISO or NSO): tax treatment at exercise and sale,
AMT exposure for ISOs, optimal exercise timing, and cost of exercise.
For ISOs, models the AMT spread and whether immediate sale (disqualifying disposition)
avoids AMT at the cost of ordinary income treatment.`,
  inputSchema: zodSchema(z.object({
    grant_id: z.string().optional().describe('Grant ID from profile to analyze. If omitted, uses first grant.'),
    shares_to_exercise: z.number().optional().describe('Number of shares to exercise. Defaults to all vested shares.'),
    current_price: z.number().describe('Current fair market value per share.'),
    exercise_date: z.string().optional().describe('ISO date of planned exercise (e.g. "2025-09-01"). Used for holding period calculations.'),
    plan_to_hold_months: z.number().optional().describe('Months you plan to hold after exercise. ISO requires 2yr from grant + 1yr from exercise for qualifying disposition.'),
  })),
  execute: async ({ grant_id, shares_to_exercise, current_price, exercise_date, plan_to_hold_months }) => {
    const profile = loadProfile()
    const options = profile.stock_options ?? []

    if (options.length === 0) {
      return { error: 'No stock options found in profile. Add stock_options to your profile to use this tool.' }
    }

    const grant = grant_id
      ? options.find(g => g.grant_id === grant_id)
      : options[0]

    if (!grant) {
      return { error: `Grant ${grant_id} not found. Available grants: ${options.map(g => g.grant_id).join(', ')}` }
    }

    const sharesToExercise = shares_to_exercise ?? grant.vested_shares
    const strikePrice = grant.strike_price
    const spread = Math.max(0, current_price - strikePrice)
    const totalSpread = spread * sharesToExercise
    const exerciseCost = strikePrice * sharesToExercise

    const filingStatus = profile.tax.filing_status
    const baseAgi = profile.tax.estimated_agi
    const stateRate = getStateRate(profile.tax.state)

    // Determine holding period status for qualifying disposition
    const grantDate = new Date(grant.grant_date)
    const exerciseDateObj = exercise_date ? new Date(exercise_date) : new Date()
    const daysSinceGrant = (exerciseDateObj.getTime() - grantDate.getTime()) / 86400000
    const twoYearsFromGrant = new Date(grantDate.getTime() + 730 * 86400000)
    const holdMonths = plan_to_hold_months ?? 0
    const saleDate = new Date(exerciseDateObj.getTime() + holdMonths * 30 * 86400000)
    const oneYearFromExercise = new Date(exerciseDateObj.getTime() + 366 * 86400000)

    const isQualifyingDisposition = grant.type === 'ISO'
      && saleDate >= twoYearsFromGrant
      && saleDate >= oneYearFromExercise

    if (grant.type === 'NSO') {
      // NSO: spread at exercise = ordinary income
      const ordinaryIncome = totalSpread
      const newAgi = baseAgi + ordinaryIncome
      const federalOnSpread = federalTaxOwed(newAgi, filingStatus) - federalTaxOwed(baseAgi, filingStatus)
      const stateOnSpread = ordinaryIncome * stateRate
      const totalTax = federalOnSpread + stateOnSpread
      const effectiveRate = ordinaryIncome > 0 ? totalTax / ordinaryIncome : 0

      return {
        grant_id: grant.grant_id,
        type: 'NSO',
        ticker: grant.ticker,
        shares_to_exercise: sharesToExercise,
        strike_price: strikePrice,
        current_price,
        spread_per_share: spread,
        total_spread: Math.round(totalSpread),
        exercise_cost: Math.round(exerciseCost),
        tax_treatment: {
          at_exercise: 'Ordinary income — spread is W-2/1099 income in the year of exercise.',
          federal_tax_on_spread: Math.round(federalOnSpread),
          state_tax_on_spread: Math.round(stateOnSpread),
          total_tax_on_spread: Math.round(totalTax),
          effective_rate_pct: parseFloat((effectiveRate * 100).toFixed(1)),
          new_cost_basis: current_price,  // basis = FMV at exercise
        },
        net_value: Math.round(totalSpread - totalTax),
        after_exercise: 'Cost basis = FMV at exercise. Any future gain/loss is capital gain/loss from that basis.',
        summary: `NSO exercise: $${Math.round(totalSpread).toLocaleString()} ordinary income. Tax: ~$${Math.round(totalTax).toLocaleString()} (${(effectiveRate * 100).toFixed(0)}% effective). Net after tax: ~$${Math.round(totalSpread - totalTax).toLocaleString()}.`,
      }
    }

    // ISO analysis
    const amtiFromSpread = totalSpread  // ISO spread is an AMT preference item
    const amtiTotal = baseAgi + amtiFromSpread
    const regularTax = federalTaxOwed(baseAgi, filingStatus)
    const tmt = tentativeMinimumTax(amtiTotal, filingStatus)
    const amtOwed = Math.max(0, tmt - regularTax)
    const amtApplies = amtOwed > 0

    // Qualifying disposition (long-term capital gains)
    const ltcgRate = profile.tax.long_term_cap_gains_rate
    const qualifyingTax = totalSpread * (ltcgRate + stateRate)

    // Disqualifying disposition (sell same year as exercise = ordinary income, no AMT)
    const newAgiDisq = baseAgi + totalSpread
    const ordinaryFederal = federalTaxOwed(newAgiDisq, filingStatus) - federalTaxOwed(baseAgi, filingStatus)
    const disqualifyingTax = ordinaryFederal + totalSpread * stateRate

    const holdingRequirement = `2 years from grant (${twoYearsFromGrant.toLocaleDateString()}) AND 1 year from exercise (${oneYearFromExercise.toLocaleDateString()})`;

    return {
      grant_id: grant.grant_id,
      type: 'ISO',
      ticker: grant.ticker,
      shares_to_exercise: sharesToExercise,
      strike_price: strikePrice,
      current_price,
      spread_per_share: spread,
      total_spread: Math.round(totalSpread),
      exercise_cost: Math.round(exerciseCost),
      qualifying_disposition: {
        requires: holdingRequirement,
        holding_period_met: isQualifyingDisposition,
        planned_sale_date: saleDate.toLocaleDateString(),
        tax_treatment: 'Long-term capital gains on entire spread',
        tax_on_spread: Math.round(qualifyingTax),
        effective_rate_pct: parseFloat(((qualifyingTax / totalSpread) * 100).toFixed(1)),
      },
      disqualifying_disposition: {
        description: 'Sell within 1 year of exercise or 2 years of grant — ordinary income treatment',
        tax_on_spread: Math.round(disqualifyingTax),
        effective_rate_pct: parseFloat(((disqualifyingTax / totalSpread) * 100).toFixed(1)),
        avoids_amt: true,
      },
      amt_analysis: {
        spread_is_amt_preference: true,
        amti_with_spread: Math.round(amtiTotal),
        tentative_minimum_tax: Math.round(tmt),
        regular_tax: Math.round(regularTax),
        amt_owed: Math.round(amtOwed),
        amt_applies: amtApplies,
        amt_note: amtApplies
          ? `Exercising these ISOs triggers ~$${Math.round(amtOwed).toLocaleString()} in AMT. Consider a partial exercise or early-year exercise when regular income is lower to reduce AMT exposure.`
          : 'No AMT triggered at current income level. Safe to exercise this year.',
      },
      tax_comparison: {
        qualifying_tax: Math.round(qualifyingTax),
        disqualifying_tax: Math.round(disqualifyingTax),
        amt_if_qualifying: Math.round(amtOwed),
        recommendation: amtApplies && amtOwed > 20_000
          ? `High AMT exposure ($${Math.round(amtOwed).toLocaleString()}). Consider: (1) partial exercise to reduce spread, (2) disqualifying disposition to eliminate AMT at cost of ordinary income treatment, (3) exercise early in year before income is known.`
          : !isQualifyingDisposition && plan_to_hold_months !== undefined
            ? `Current hold plan (${holdMonths} months) does not meet qualifying disposition requirement. Extend hold to qualify for LTCG rates — saves $${Math.round(disqualifyingTax - qualifyingTax).toLocaleString()} in taxes.`
            : 'Exercise and hold for qualifying disposition — LTCG treatment is most tax-efficient.',
      },
      vested_shares: grant.vested_shares,
      unvested_shares: grant.unvested_shares,
      expiration_date: grant.expiration_date,
      summary: `ISO grant: ${sharesToExercise} shares @ $${strikePrice} strike, $${current_price} FMV = $${Math.round(totalSpread).toLocaleString()} spread. ${amtApplies ? `AMT: $${Math.round(amtOwed).toLocaleString()}. ` : 'No AMT. '}Qualifying disposition tax: $${Math.round(qualifyingTax).toLocaleString()} vs disqualifying: $${Math.round(disqualifyingTax).toLocaleString()}.`,
    }
  },
})

// ---------------------------------------------------------------------------
// plan_529
// ---------------------------------------------------------------------------

export const plan529 = tool({
  description: `529 education savings plan analysis: how much to contribute for a target
education cost, state tax deduction (if applicable), superfunding (5-year gift tax election),
annual contribution pace, and UTMA vs 529 tradeoffs.`,
  inputSchema: zodSchema(z.object({
    beneficiary_name: z.string().optional().describe('Name of beneficiary. Matches dependents in profile.'),
    target_education_cost: z.number().optional().describe('Estimated total education cost in today\'s dollars. Defaults to $350,000 for 4-year private university.'),
    current_529_balance: z.number().optional().describe('Current 529 balance for this beneficiary. Reads from profile accounts if omitted.'),
    years_until_college: z.number().optional().describe('Years until the beneficiary starts college. Derived from dependent age if omitted.'),
    state: z.string().optional().describe('State for tax deduction analysis. Reads from profile if omitted.'),
    monthly_contribution: z.number().optional().describe('Monthly contribution to model. If omitted, calculates required amount.'),
    consider_superfunding: z.boolean().optional().describe('Whether to model the 5-year gift tax election (superfunding). Defaults to true.'),
  })),
  execute: async ({
    beneficiary_name,
    target_education_cost = 350_000,
    current_529_balance,
    years_until_college,
    state,
    monthly_contribution,
    consider_superfunding = true,
  }) => {
    const profile = loadProfile()

    // Find beneficiary from dependents
    const dependent = beneficiary_name
      ? profile.dependents?.find(d => d.name.toLowerCase() === beneficiary_name.toLowerCase())
      : profile.dependents?.find(d => d.relationship === 'child')

    const beneficiaryAge = dependent?.age ?? 0
    const yearsToCollege = years_until_college ?? Math.max(1, 18 - beneficiaryAge)

    // Find 529 account if exists
    const account529 = profile.accounts.find(a => a.name.toLowerCase().includes('529'))
    const currentBalance = current_529_balance ?? account529?.balance ?? 0

    // State tax deduction (limited set of states offer deductions)
    const profileState = state ?? profile.tax.state
    const stateDeductionMap: Record<string, { deduction: number; rate: number; limit_per_filer: number }> = {
      NY: { deduction: 5_000, rate: 0.085, limit_per_filer: 5_000 },
      VA: { deduction: Infinity, rate: 0.057, limit_per_filer: Infinity },  // no cap
      IL: { deduction: 10_000, rate: 0.0495, limit_per_filer: 10_000 },
      OH: { deduction: 4_000, rate: 0.035, limit_per_filer: 4_000 },
      PA: { deduction: Infinity, rate: 0.030, limit_per_filer: Infinity },
      SC: { deduction: Infinity, rate: 0.065, limit_per_filer: Infinity },
      IN: { deduction: 1_000, rate: 0.03, limit_per_filer: 1_000 },  // credit, not deduction
      MO: { deduction: 8_000, rate: 0.048, limit_per_filer: 8_000 },
      CO: { deduction: Infinity, rate: 0.044, limit_per_filer: Infinity },
      MI: { deduction: 10_000, rate: 0.0425, limit_per_filer: 10_000 },
    }

    const stateDeductionInfo = stateDeductionMap[profileState.toUpperCase()]
    const stateDeductionAvailable = !!stateDeductionInfo

    // Compute required monthly contribution to hit target
    const growthRate = 0.07  // 7% annual nominal return (equity-heavy 529)
    const monthlyRate = growthRate / 12
    const months = yearsToCollege * 12

    // FV of current balance
    const fvCurrentBalance = currentBalance * Math.pow(1 + growthRate, yearsToCollege)

    // Additional amount needed
    const additionalNeeded = Math.max(0, target_education_cost - fvCurrentBalance)

    // Monthly contribution required using FV of annuity
    let requiredMonthly: number
    if (monthlyRate > 0 && months > 0) {
      requiredMonthly = additionalNeeded / ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate)
    } else {
      requiredMonthly = additionalNeeded / Math.max(1, months)
    }

    // Model chosen monthly contribution
    const chosenMonthly = monthly_contribution ?? requiredMonthly
    const fvContributions = chosenMonthly * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate)
    const projectedBalance = fvCurrentBalance + fvContributions
    const fundingGap = Math.max(0, target_education_cost - projectedBalance)
    const fundingExcess = Math.max(0, projectedBalance - target_education_cost)

    // Annual contribution
    const annualContribution = chosenMonthly * 12

    // Gift tax analysis
    const annualGiftExclusion = ANNUAL_GIFT_EXCLUSION  // 18,000
    const superfundingMax = MAX_529_SUPERFUNDING  // 90,000

    const exceedsAnnualExclusion = annualContribution > annualGiftExclusion
    const superfundingNote = consider_superfunding
      ? `Superfunding allows contributing up to $${superfundingMax.toLocaleString()} in a single year (5-year gift tax election), removing it from your taxable estate immediately. You and a spouse can contribute $${(superfundingMax * 2).toLocaleString()} total. No additional gifts to same beneficiary for 5 years.`
      : undefined

    // State tax savings on annual contribution
    const deductibleAmount = stateDeductionInfo
      ? Math.min(annualContribution, stateDeductionInfo.limit_per_filer)
      : 0
    const annualStateTaxSavings = deductibleAmount * (stateDeductionInfo?.rate ?? 0)

    // UTMA vs 529 comparison
    const utmaVs529 = {
      '529': {
        pros: [
          'Tax-free growth and withdrawals for qualified education expenses',
          'State tax deduction available in some states',
          'Can change beneficiary to another family member',
          'Superfunding option (5-year gift tax election)',
          'Lower FAFSA impact than UTMA (5.64% vs up to 20%)',
        ],
        cons: [
          '10% penalty + income tax on non-qualified withdrawals',
          'Limited investment options (plan-defined)',
          'Qualified expenses only (tuition, books, room/board, K-12 up to $10k/yr)',
        ],
      },
      UTMA: {
        pros: [
          'No restrictions on use of funds',
          'Broader investment options (any brokerage account)',
          'No penalty for non-education use',
        ],
        cons: [
          'Earnings taxed annually (kiddie tax rules may apply)',
          'Assets become child\'s property at majority (18-21)',
          'Higher FAFSA impact',
          'Capital gains tax on appreciated assets when sold',
        ],
      },
    }

    return {
      beneficiary: dependent?.name ?? 'unknown',
      beneficiary_age: beneficiaryAge,
      years_to_college: yearsToCollege,
      target_education_cost,
      current_balance: currentBalance,
      fv_current_balance: Math.round(fvCurrentBalance),
      projection: {
        chosen_monthly_contribution: Math.round(chosenMonthly),
        annual_contribution: Math.round(annualContribution),
        projected_balance_at_college: Math.round(projectedBalance),
        funding_gap: Math.round(fundingGap),
        funding_excess: Math.round(fundingExcess),
        on_track: fundingGap === 0,
      },
      required_monthly_to_fully_fund: Math.round(requiredMonthly),
      assumed_annual_return_pct: 7.0,
      gift_tax: {
        annual_exclusion: annualGiftExclusion,
        exceeds_annual_exclusion: exceedsAnnualExclusion,
        superfunding_max_single: superfundingMax,
        superfunding_max_couple: superfundingMax * 2,
        superfunding_note: superfundingNote,
      },
      state_tax_deduction: {
        state: profileState,
        available: stateDeductionAvailable,
        annual_deductible_amount: Math.round(deductibleAmount),
        annual_state_tax_savings: Math.round(annualStateTaxSavings),
        note: stateDeductionAvailable
          ? `${profileState} offers a 529 deduction of up to $${stateDeductionInfo!.limit_per_filer === Infinity ? 'unlimited' : stateDeductionInfo!.limit_per_filer.toLocaleString()}/filer at ${(stateDeductionInfo!.rate * 100).toFixed(1)}% state rate.`
          : `${profileState} does not offer a state income tax deduction for 529 contributions. Any nationally available 529 plan works — consider Nevada, Utah, or New York plans for low costs.`,
      },
      utma_vs_529: utmaVs529,
      summary: fundingGap > 0
        ? `At $${Math.round(chosenMonthly).toLocaleString()}/mo, projected balance is $${Math.round(projectedBalance).toLocaleString()} vs $${target_education_cost.toLocaleString()} target — $${Math.round(fundingGap).toLocaleString()} short. Increase to $${Math.round(requiredMonthly).toLocaleString()}/mo to fully fund.`
        : `At $${Math.round(chosenMonthly).toLocaleString()}/mo, projected to over-fund by $${Math.round(fundingExcess).toLocaleString()}. Consider reducing contributions or using excess for grad school / beneficiary change.`,
    }
  },
})

// ---------------------------------------------------------------------------
// calculate_net_worth
// ---------------------------------------------------------------------------

export const calculateNetWorth = tool({
  description: `Calculate total net worth: assets minus liabilities, with liquid vs illiquid breakdown.
Also computes home equity, investable assets, and debt service ratios.`,
  inputSchema: zodSchema(z.object({})),
  execute: async () => {
    const profile = loadProfile()

    // Assets
    const investmentAccounts = profile.accounts.filter(a => a.tax_treatment !== 'cash')
    const cashAccounts = profile.accounts.filter(a => a.tax_treatment === 'cash')

    const investmentTotal = investmentAccounts.reduce((s, a) => s + a.balance, 0)
    const cashTotal = cashAccounts.reduce((s, a) => s + a.balance, 0)

    // Real estate equity
    const mortgages = profile.liabilities?.filter(l => l.type === 'mortgage') ?? []
    const homeEquity = mortgages.reduce((s, m) => s + (m.property_value ?? 0) - m.balance, 0)
    const realEstateValue = mortgages.reduce((s, m) => s + (m.property_value ?? 0), 0)

    // Stock options intrinsic value (vested only, illustrative)
    const optionsValue = profile.stock_options?.reduce((s, g) => {
      // We can't know current price without querying — skip in net worth, note separately
      return s
    }, 0) ?? 0

    const totalAssets = investmentTotal + cashTotal + realEstateValue

    // Liabilities
    const liabilities = profile.liabilities ?? []
    const totalLiabilities = liabilities.reduce((s, l) => s + l.balance, 0)
    const netWorth = totalAssets - totalLiabilities

    // Liquid assets (cash + taxable investments)
    const taxableInvestments = profile.accounts
      .filter(a => a.tax_treatment === 'taxable')
      .reduce((s, a) => s + a.balance, 0)
    const liquidAssets = cashTotal + taxableInvestments

    // Semi-liquid (tax-advantaged — accessible with penalty/rules)
    const semiLiquidAssets = profile.accounts
      .filter(a => a.tax_treatment === 'tax_free' || a.tax_treatment === 'tax_deferred')
      .reduce((s, a) => s + a.balance, 0)

    // Debt service ratio
    const monthlyIncome = (profile.income?.reduce((s, i) => s + i.annual_amount, 0) ?? 0) / 12
    const monthlyDebtPayments = liabilities.reduce((s, l) => s + l.monthly_payment, 0)
    const debtToIncomeRatio = monthlyIncome > 0 ? monthlyDebtPayments / monthlyIncome : null

    // Asset allocation by type
    const accountBreakdown = profile.accounts.map(a => ({
      name: a.name,
      balance: a.balance,
      tax_treatment: a.tax_treatment,
      pct_of_investment: investmentTotal > 0 ? parseFloat(((a.balance / (investmentTotal + cashTotal)) * 100).toFixed(1)) : 0,
    }))

    const liabilityBreakdown = liabilities.map(l => ({
      name: l.name,
      type: l.type,
      balance: l.balance,
      interest_rate: l.interest_rate,
      monthly_payment: l.monthly_payment,
      pct_of_total_debt: totalLiabilities > 0 ? parseFloat(((l.balance / totalLiabilities) * 100).toFixed(1)) : 0,
    }))

    return {
      net_worth: Math.round(netWorth),
      assets: {
        total: Math.round(totalAssets),
        investment_accounts: Math.round(investmentTotal),
        cash: Math.round(cashTotal),
        real_estate_value: Math.round(realEstateValue),
        home_equity: Math.round(homeEquity),
        breakdown: accountBreakdown,
      },
      liabilities: {
        total: Math.round(totalLiabilities),
        breakdown: liabilityBreakdown,
      },
      liquidity: {
        liquid: Math.round(liquidAssets),
        semi_liquid: Math.round(semiLiquidAssets),
        illiquid: Math.round(realEstateValue),
        liquid_pct_of_net_worth: netWorth > 0 ? parseFloat(((liquidAssets / netWorth) * 100).toFixed(1)) : null,
      },
      debt_metrics: {
        total_debt: Math.round(totalLiabilities),
        monthly_debt_payments: Math.round(monthlyDebtPayments),
        monthly_income: Math.round(monthlyIncome),
        debt_to_income_ratio_pct: debtToIncomeRatio !== null ? parseFloat((debtToIncomeRatio * 100).toFixed(1)) : null,
        dti_status: debtToIncomeRatio !== null
          ? debtToIncomeRatio < 0.28 ? 'healthy' : debtToIncomeRatio < 0.36 ? 'manageable' : 'high'
          : 'unknown',
      },
      note_on_stock_options: profile.stock_options?.length
        ? `${profile.stock_options.length} stock option grant(s) not included in net worth — use plan_stock_options tool with a current price to value them.`
        : undefined,
      summary: `Net worth: $${Math.round(netWorth).toLocaleString()} ($${Math.round(totalAssets).toLocaleString()} assets − $${Math.round(totalLiabilities).toLocaleString()} liabilities). Liquid: $${Math.round(liquidAssets).toLocaleString()}. DTI: ${debtToIncomeRatio !== null ? (debtToIncomeRatio * 100).toFixed(0) + '%' : 'N/A'}.`,
    }
  },
})
