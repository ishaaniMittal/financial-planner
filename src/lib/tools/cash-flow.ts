import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { loadProfile, excessCash, totalCash } from '../profile'

const FEDERAL_BRACKETS_SINGLE_2025: [number, number][] = [
  [11925, 0.10], [48475, 0.12], [103350, 0.22], [197300, 0.24],
  [250525, 0.32], [626350, 0.35], [Infinity, 0.37],
]
const FEDERAL_BRACKETS_MFJ_2025: [number, number][] = [
  [23850, 0.10], [96950, 0.12], [206700, 0.22], [394600, 0.24],
  [501050, 0.32], [751600, 0.35], [Infinity, 0.37],
]
const STATE_RATES: Record<string, number> = {
  CA: 0.093, NY: 0.0685, TX: 0.0, WA: 0.0, FL: 0.0,
  IL: 0.0495, MA: 0.05, NJ: 0.0675, CO: 0.044,
}

export const getContributionLimits = tool({
  description:
    'Get IRS contribution limits for all account types. Shows annual max, YTD contributions, and remaining capacity for each account.',
  inputSchema: zodSchema(z.object({
    year: z.number().optional().describe('Tax year. Defaults to 2025.'),
  })),
  execute: async ({ year = 2025 }) => {
    const profile = loadProfile()
    const expectedPct = profile.current_month / 12
    const monthsLeft = 12 - profile.current_month

    const lines: string[] = [`=== IRS Contribution Limits (${year}) ===\n`]
    lines.push('Standard Limits:')
    lines.push('  401(k) / 403(b) / 457(b): $23,500')
    lines.push('  IRA (Traditional + Roth combined): $7,000')
    lines.push('  HSA (individual): $4,300 | HSA (family): $8,550')
    lines.push('  ESPP: $25,000 (fair market value)')
    lines.push('  Catch-up (age 50+): +$7,500 for 401k, +$1,000 for IRA\n')

    lines.push('Your Account Status:')
    lines.push(`${'Account'.padEnd(22)} ${'Limit'.padStart(10)} ${'YTD'.padStart(10)} ${'Remaining'.padStart(10)} ${'Pace'.padStart(8)}`)
    lines.push('-'.repeat(65))

    let totalRemaining = 0
    for (const account of profile.accounts) {
      if (account.annual_contribution_limit === null) continue
      const remaining = account.annual_contribution_limit - account.ytd_contribution
      totalRemaining += remaining
      const pctUsed = account.ytd_contribution / account.annual_contribution_limit
      let pace = pctUsed >= expectedPct - 0.05 ? 'On Track' : 'Behind'
      if (pctUsed >= 1.0) pace = 'Maxed'
      lines.push(
        `  ${account.name.padEnd(20)} $${account.annual_contribution_limit.toLocaleString().padStart(8)} $${account.ytd_contribution.toLocaleString().padStart(8)} $${remaining.toLocaleString().padStart(8)} ${pace.padStart(8)}`
      )
    }

    lines.push('-'.repeat(65))
    lines.push(`  Total remaining tax-advantaged space: $${totalRemaining.toLocaleString()}`)
    lines.push(`  Months remaining in year: ${monthsLeft}`)
    if (monthsLeft > 0) {
      lines.push(`  Required monthly rate to max all: $${Math.round(totalRemaining / monthsLeft).toLocaleString()}/mo`)
    }
    return lines.join('\n')
  },
})

export const checkContributionPace = tool({
  description:
    'Check whether contributions to each account are on pace to max out by year-end. Flags accounts behind schedule.',
  inputSchema: zodSchema(z.object({})),
  execute: async () => {
    const profile = loadProfile()
    const expectedPct = profile.current_month / 12
    const monthsLeft = 12 - profile.current_month

    const lines: string[] = [`=== Contribution Pace Check (Month ${profile.current_month}/12) ===\n`]
    lines.push(`Expected pace: ${Math.round(expectedPct * 100)}% of annual limits used\n`)

    const behind: string[] = [], onTrack: string[] = [], maxed: string[] = []

    for (const account of profile.accounts) {
      if (account.annual_contribution_limit === null) continue
      const actualPct = account.ytd_contribution / account.annual_contribution_limit
      const remaining = account.annual_contribution_limit - account.ytd_contribution

      if (actualPct >= 1.0) {
        maxed.push(`  ${account.name}: MAXED ($${account.annual_contribution_limit.toLocaleString()})`)
      } else if (actualPct >= expectedPct - 0.05) {
        onTrack.push(`  ${account.name}: ${Math.round(actualPct * 100)}% used ($${remaining.toLocaleString()} remaining)`)
      } else {
        const deficit = expectedPct * account.annual_contribution_limit - account.ytd_contribution
        const monthlyNeeded = monthsLeft > 0 ? remaining / monthsLeft : remaining
        behind.push(
          `  ${account.name}: ${Math.round(actualPct * 100)}% used — $${Math.round(deficit).toLocaleString()} behind pace — need $${Math.round(monthlyNeeded).toLocaleString()}/mo to max out`
        )
      }
    }

    if (maxed.length) { lines.push('Maxed Out:'); lines.push(...maxed); lines.push('') }
    if (onTrack.length) { lines.push('On Track:'); lines.push(...onTrack); lines.push('') }
    if (behind.length) {
      lines.push('Behind Pace:'); lines.push(...behind); lines.push('')
      lines.push('Action: Increase contributions to behind accounts before adding to taxable.')
    } else {
      lines.push('All accounts with limits are on track or maxed.')
    }

    return lines.join('\n')
  },
})

export const calculateTaxBracket = tool({
  description:
    'Calculate the federal and state tax brackets for the user. Helps decide between Roth and Traditional contributions.',
  inputSchema: zodSchema(z.object({
    additional_income: z.number().optional().describe('Optional additional income to model marginal impact.'),
  })),
  execute: async ({ additional_income = 0 }) => {
    const profile = loadProfile()
    const agi = profile.tax.estimated_agi + additional_income
    const brackets = profile.tax.filing_status === 'married_filing_jointly'
      ? FEDERAL_BRACKETS_MFJ_2025
      : FEDERAL_BRACKETS_SINGLE_2025

    let federalTax = 0, prevLimit = 0, marginalRate = 0
    for (const [limit, rate] of brackets) {
      if (agi <= limit) { federalTax += (agi - prevLimit) * rate; marginalRate = rate; break }
      federalTax += (limit - prevLimit) * rate; prevLimit = limit; marginalRate = rate
    }

    const stateRate = STATE_RATES[profile.tax.state] ?? 0.05
    const effectiveFederal = agi > 0 ? federalTax / agi : 0
    const combined = marginalRate + stateRate

    const lines: string[] = ['=== Tax Bracket Analysis ===\n']
    lines.push(`Filing Status: ${profile.tax.filing_status.replace(/_/g, ' ')}`)
    lines.push(`State: ${profile.tax.state}`)
    lines.push(`Estimated AGI: $${agi.toLocaleString()}`)
    if (additional_income > 0) lines.push(`  (includes $${additional_income.toLocaleString()} additional income)`)
    lines.push('')
    lines.push(`Federal Marginal Rate: ${(marginalRate * 100).toFixed(1)}%`)
    lines.push(`Federal Effective Rate: ${(effectiveFederal * 100).toFixed(1)}%`)
    lines.push(`State Marginal Rate: ${(stateRate * 100).toFixed(1)}%`)
    lines.push(`Combined Marginal Rate: ${(combined * 100).toFixed(1)}%`)
    lines.push(`Long-Term Cap Gains Rate: ${(profile.tax.long_term_cap_gains_rate * 100).toFixed(1)}%`)
    lines.push(`NIIT (3.8%): ${agi > 200000 ? 'Applies' : 'Does not apply'}`)
    lines.push('\n--- Roth vs. Traditional Guidance ---')
    if (combined >= 0.35) {
      lines.push('At your high marginal rate (35%+), Traditional contributions provide significant tax savings NOW.')
    } else if (combined >= 0.25) {
      lines.push('Moderate bracket — a mix of Roth and Traditional is optimal.')
    } else {
      lines.push('Lower bracket — Roth contributions are favored.')
    }

    return lines.join('\n')
  },
})

export const detectIdleCash = tool({
  description:
    'Analyze cash holdings to detect money sitting idle beyond the emergency fund target. Calculates opportunity cost and suggests deployment.',
  inputSchema: zodSchema(z.object({})),
  execute: async () => {
    const profile = loadProfile()
    const cash = totalCash(profile)
    const excess = excessCash(profile)

    const lines: string[] = ['=== Idle Cash Detection ===\n']
    lines.push(`Total Cash Holdings: $${cash.toLocaleString()}`)
    lines.push(`Emergency Fund Target: $${profile.target_emergency_fund.toLocaleString()}`)
    lines.push(`Excess Cash: $${excess.toLocaleString()}\n`)

    lines.push('Cash Account Breakdown:')
    for (const acc of profile.accounts.filter(a => a.tax_treatment === 'cash')) {
      lines.push(`  ${acc.name}: $${acc.balance.toLocaleString()}`)
    }
    lines.push('')

    if (excess <= 0) {
      lines.push('Cash position is appropriate. No idle money detected.')
      return lines.join('\n')
    }

    const opportunityCost = excess * (0.07 - 0.045)
    lines.push(`$${excess.toLocaleString()} is sitting idle beyond your emergency fund.`)
    lines.push(`  Estimated annual opportunity cost: $${Math.round(opportunityCost).toLocaleString()}`)
    lines.push('  (assuming 7% market return vs 4.5% HYSA rate)\n')

    lines.push('Recommended deployment priority:')
    let remaining = excess
    const priorities: ['tax_free' | 'tax_deferred' | 'taxable', string][] = [
      ['tax_free', 'Tax-Free (highest efficiency)'],
      ['tax_deferred', 'Tax-Deferred'],
      ['taxable', 'Taxable (lowest priority)'],
    ]
    for (const [treatment, label] of priorities) {
      if (remaining <= 0) break
      for (const acc of profile.accounts.filter(
        a => a.tax_treatment === treatment &&
          a.annual_contribution_limit !== null &&
          a.ytd_contribution < a.annual_contribution_limit!
      )) {
        if (remaining <= 0) break
        const capacity = acc.annual_contribution_limit! - acc.ytd_contribution
        const deploy = Math.min(remaining, capacity)
        if (deploy > 0) { lines.push(`  → $${deploy.toLocaleString()} → ${acc.name} (${label})`); remaining -= deploy }
      }
    }
    if (remaining > 0) lines.push(`  → $${remaining.toLocaleString()} → Brokerage (all tax-advantaged space filled)`)

    return lines.join('\n')
  },
})

export const suggestRebalancing = tool({
  description:
    'Generate specific rebalancing recommendations based on target allocation vs actual, contribution pace, and idle cash.',
  inputSchema: zodSchema(z.object({})),
  execute: async () => {
    const profile = loadProfile()
    const total = profile.accounts.reduce((s, a) => s + a.balance, 0)
    const expectedPct = profile.current_month / 12
    const monthsLeft = 12 - profile.current_month
    const excess = excessCash(profile)

    const lines: string[] = ['=== Rebalancing Recommendations ===\n']
    const recs: { priority: number; msg: string }[] = []

    lines.push('--- Allocation Drift ---')
    for (const account of profile.accounts) {
      const actualPct = total > 0 ? (account.balance / total) * 100 : 0
      const drift = actualPct - account.target_allocation_pct
      if (Math.abs(drift) > 2.0) {
        const dir = drift > 0 ? 'OVER' : 'UNDER'
        const dollarDrift = Math.abs((drift / 100) * total)
        recs.push({
          priority: Math.abs(drift) > 5 ? 1 : 2,
          msg: `${dir}-allocated: ${account.name} (${actualPct.toFixed(1)}% vs ${account.target_allocation_pct}% target, $${Math.round(dollarDrift).toLocaleString()} drift)`,
        })
      }
    }

    if (excess > 500) recs.push({ priority: 1, msg: `DEPLOY: $${excess.toLocaleString()} excess cash beyond emergency fund` })

    for (const account of profile.accounts) {
      if (account.annual_contribution_limit === null) continue
      const actualPct = account.ytd_contribution / account.annual_contribution_limit
      if (actualPct < expectedPct - 0.1) {
        const remaining = account.annual_contribution_limit - account.ytd_contribution
        const monthlyNeeded = monthsLeft > 0 ? remaining / monthsLeft : remaining
        recs.push({ priority: 1, msg: `INCREASE: ${account.name} needs $${Math.round(monthlyNeeded).toLocaleString()}/mo to max by year-end` })
      }
    }

    recs.sort((a, b) => a.priority - b.priority)
    if (!recs.length) {
      lines.push('  All allocations within 2% of target. No rebalancing needed.')
    } else {
      lines.push(`  Found ${recs.length} action items:\n`)
      for (const r of recs) {
        lines.push(`  [${r.priority === 1 ? 'HIGH' : 'MEDIUM'}] ${r.msg}`)
      }
    }

    lines.push('\n--- Monthly Action Plan ---')
    if (monthsLeft > 0 && excess > 0) {
      lines.push(`  Step 1: Move $${Math.min(excess, 2150).toLocaleString()} excess cash → HSA (if capacity remains)`)
      lines.push('  Step 2: Increase 401(k) deferral to max by December')
      lines.push('  Step 3: Invest remainder in brokerage (tax-efficient funds)')
    } else {
      lines.push('  Continue current contribution rates — you\'re on track.')
    }

    return lines.join('\n')
  },
})
