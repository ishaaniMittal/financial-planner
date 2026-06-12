import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { loadProfile, excessCash, totalCash } from '../profile'
import { getBrackets, getStateRate, federalTaxOwed, federalMarginalRate, TAX_YEAR } from '../tax-data'

export const getContributionLimits = tool({
  description:
    'Get IRS contribution limits for all account types. Returns annual max, YTD contributions, remaining capacity, and pace status for each account.',
  inputSchema: zodSchema(z.object({
    year: z.number().optional().describe(`Tax year. Defaults to ${TAX_YEAR}.`),
  })),
  execute: async ({ year = TAX_YEAR }) => {
    const profile = loadProfile()
    const expectedPct = profile.current_month / 12
    const monthsLeft = 12 - profile.current_month

    const accounts = profile.accounts
      .filter(a => a.annual_contribution_limit !== null)
      .map(a => {
        const remaining = a.annual_contribution_limit! - a.ytd_contribution
        const pctUsed = a.ytd_contribution / a.annual_contribution_limit!
        let pace: 'maxed' | 'on_track' | 'behind' = 'behind'
        if (pctUsed >= 1.0) pace = 'maxed'
        else if (pctUsed >= expectedPct - 0.05) pace = 'on_track'
        return {
          name: a.name,
          annual_limit: a.annual_contribution_limit!,
          ytd_contribution: a.ytd_contribution,
          remaining,
          pct_used: parseFloat((pctUsed * 100).toFixed(1)),
          pace,
        }
      })

    const totalRemaining = accounts.reduce((s, a) => s + a.remaining, 0)
    const requiredMonthlyRate = monthsLeft > 0 ? Math.round(totalRemaining / monthsLeft) : 0

    return {
      year,
      current_month: profile.current_month,
      months_left: monthsLeft,
      accounts,
      total_remaining: totalRemaining,
      required_monthly_rate: requiredMonthlyRate,
      standard_limits: {
        '401k_403b_457b': 23500,
        ira: 7000,
        hsa_individual: 4300,
        hsa_family: 8550,
        espp_fmv: 25000,
        catchup_401k: 7500,
        catchup_ira: 1000,
      },
      summary: `${accounts.filter(a => a.pace === 'maxed').length} maxed, ${accounts.filter(a => a.pace === 'on_track').length} on track, ${accounts.filter(a => a.pace === 'behind').length} behind. $${totalRemaining.toLocaleString()} remaining across all accounts. Need $${requiredMonthlyRate.toLocaleString()}/mo to max everything by year-end.`,
    }
  },
})

export const checkContributionPace = tool({
  description:
    'Check whether contributions to each account are on pace to max out by year-end. Flags accounts behind schedule with the monthly increase needed.',
  inputSchema: zodSchema(z.object({})),
  execute: async () => {
    const profile = loadProfile()
    const expectedPct = profile.current_month / 12
    const monthsLeft = 12 - profile.current_month

    const behind: { name: string; pct_used: number; deficit: number; monthly_needed: number; remaining: number }[] = []
    const on_track: { name: string; pct_used: number; remaining: number }[] = []
    const maxed: { name: string; annual_limit: number }[] = []

    for (const account of profile.accounts) {
      if (account.annual_contribution_limit === null) continue
      const actualPct = account.ytd_contribution / account.annual_contribution_limit
      const remaining = account.annual_contribution_limit - account.ytd_contribution

      if (actualPct >= 1.0) {
        maxed.push({ name: account.name, annual_limit: account.annual_contribution_limit })
      } else if (actualPct >= expectedPct - 0.05) {
        on_track.push({ name: account.name, pct_used: parseFloat((actualPct * 100).toFixed(1)), remaining })
      } else {
        const deficit = expectedPct * account.annual_contribution_limit - account.ytd_contribution
        const monthly_needed = monthsLeft > 0 ? Math.round(remaining / monthsLeft) : remaining
        behind.push({
          name: account.name,
          pct_used: parseFloat((actualPct * 100).toFixed(1)),
          deficit: Math.round(deficit),
          monthly_needed,
          remaining,
        })
      }
    }

    return {
      current_month: profile.current_month,
      expected_pct_used: parseFloat((expectedPct * 100).toFixed(1)),
      months_left: monthsLeft,
      behind,
      on_track,
      maxed,
      action_needed: behind.length > 0,
      summary: behind.length === 0
        ? 'All accounts with limits are on track or maxed.'
        : `${behind.length} account(s) behind pace: ${behind.map(a => `${a.name} (needs $${a.monthly_needed}/mo)`).join(', ')}.`,
    }
  },
})

export const calculateTaxBracket = tool({
  description:
    'Calculate federal and state tax brackets. Returns marginal rates, effective rate, and Roth vs Traditional guidance.',
  inputSchema: zodSchema(z.object({
    additional_income: z.number().optional().describe('Optional additional income to model marginal impact.'),
  })),
  execute: async ({ additional_income = 0 }) => {
    const profile = loadProfile()
    const agi = profile.tax.estimated_agi + additional_income
    const federalTax = federalTaxOwed(agi, profile.tax.filing_status)
    const marginalRate = federalMarginalRate(agi, profile.tax.filing_status)
    const stateRate = getStateRate(profile.tax.state)
    const effectiveFederal = agi > 0 ? federalTax / agi : 0
    const combined = marginalRate + stateRate

    let roth_vs_traditional: 'roth' | 'traditional' | 'mix'
    let roth_vs_traditional_reason: string
    if (combined >= 0.35) {
      roth_vs_traditional = 'traditional'
      roth_vs_traditional_reason = 'High combined rate (35%+). Traditional contributions provide significant upfront tax savings.'
    } else if (combined >= 0.25) {
      roth_vs_traditional = 'mix'
      roth_vs_traditional_reason = 'Moderate bracket. A mix of Roth and Traditional is optimal.'
    } else {
      roth_vs_traditional = 'roth'
      roth_vs_traditional_reason = 'Lower bracket. Roth contributions are favored — pay tax now at low rates.'
    }

    return {
      filing_status: profile.tax.filing_status,
      state: profile.tax.state,
      agi,
      additional_income_modeled: additional_income,
      marginal_federal_rate: parseFloat((marginalRate * 100).toFixed(1)),
      effective_federal_rate: parseFloat((effectiveFederal * 100).toFixed(1)),
      marginal_state_rate: parseFloat((stateRate * 100).toFixed(1)),
      combined_marginal_rate: parseFloat((combined * 100).toFixed(1)),
      ltcg_rate: parseFloat((profile.tax.long_term_cap_gains_rate * 100).toFixed(1)),
      niit_applies: agi > 200000,
      roth_vs_traditional,
      roth_vs_traditional_reason,
      summary: `${(marginalRate * 100).toFixed(0)}% federal + ${(stateRate * 100).toFixed(1)}% state = ${(combined * 100).toFixed(1)}% combined marginal rate. Recommendation: ${roth_vs_traditional === 'mix' ? 'mix Roth and Traditional' : roth_vs_traditional.toUpperCase()}.`,
    }
  },
})

export const detectIdleCash = tool({
  description:
    'Analyze cash holdings to detect money sitting idle beyond the emergency fund target. Returns opportunity cost and a prioritized deployment plan.',
  inputSchema: zodSchema(z.object({})),
  execute: async () => {
    const profile = loadProfile()
    const cash = totalCash(profile)
    const excess = excessCash(profile)

    const cash_accounts = profile.accounts
      .filter(a => a.tax_treatment === 'cash')
      .map(a => ({ name: a.name, balance: a.balance }))

    const opportunity_cost_annual = excess > 0 ? Math.round(excess * (0.07 - 0.045)) : 0

    const deployment_plan: { account: string; amount: number; tax_treatment: string; priority: number }[] = []
    if (excess > 0) {
      let remaining = excess
      let priority = 1
      const order: Array<'tax_free' | 'tax_deferred' | 'taxable'> = ['tax_free', 'tax_deferred', 'taxable']
      for (const treatment of order) {
        for (const acc of profile.accounts.filter(
          a => a.tax_treatment === treatment &&
            a.annual_contribution_limit !== null &&
            a.ytd_contribution < a.annual_contribution_limit!
        )) {
          if (remaining <= 0) break
          const capacity = acc.annual_contribution_limit! - acc.ytd_contribution
          const deploy = Math.min(remaining, capacity)
          if (deploy > 0) {
            deployment_plan.push({ account: acc.name, amount: deploy, tax_treatment: treatment, priority })
            remaining -= deploy
          }
          priority++
        }
      }
      if (remaining > 0) {
        deployment_plan.push({ account: 'Brokerage (taxable)', amount: remaining, tax_treatment: 'taxable', priority })
      }
    }

    return {
      total_cash: cash,
      emergency_fund_target: profile.target_emergency_fund,
      excess_cash: excess,
      cash_accounts,
      opportunity_cost_annual,
      opportunity_cost_note: '7% market return vs 4.5% HYSA',
      idle_cash_detected: excess > 0,
      deployment_plan,
      summary: excess <= 0
        ? 'Cash position is appropriate. No idle money detected.'
        : `$${excess.toLocaleString()} idle beyond emergency fund. Estimated annual opportunity cost: $${opportunity_cost_annual.toLocaleString()}. Deploy across ${deployment_plan.length} account(s).`,
    }
  },
})

export const suggestRebalancing = tool({
  description:
    'Generate rebalancing recommendations based on allocation drift, contribution pace, and idle cash. Returns prioritized action items and a monthly plan.',
  inputSchema: zodSchema(z.object({})),
  execute: async () => {
    const profile = loadProfile()
    const total = profile.accounts.reduce((s, a) => s + a.balance, 0)
    const expectedPct = profile.current_month / 12
    const monthsLeft = 12 - profile.current_month
    const excess = excessCash(profile)

    const actions: { priority: 'high' | 'medium'; type: 'drift' | 'deploy_cash' | 'increase_contributions'; account: string; message: string; drift_pct?: number; dollar_amount?: number }[] = []

    for (const account of profile.accounts) {
      const actualPct = total > 0 ? (account.balance / total) * 100 : 0
      const drift = actualPct - account.target_allocation_pct
      if (Math.abs(drift) > 2.0) {
        const dollarDrift = Math.abs((drift / 100) * total)
        actions.push({
          priority: Math.abs(drift) > 5 ? 'high' : 'medium',
          type: 'drift',
          account: account.name,
          message: `${drift > 0 ? 'Over' : 'Under'}-allocated by ${Math.abs(drift).toFixed(1)}pp ($${Math.round(dollarDrift).toLocaleString()})`,
          drift_pct: parseFloat(drift.toFixed(2)),
          dollar_amount: Math.round(dollarDrift),
        })
      }
    }

    if (excess > 500) {
      actions.push({
        priority: 'high',
        type: 'deploy_cash',
        account: 'Cash',
        message: `Deploy $${excess.toLocaleString()} excess cash`,
        dollar_amount: excess,
      })
    }

    for (const account of profile.accounts) {
      if (account.annual_contribution_limit === null) continue
      const actualPct = account.ytd_contribution / account.annual_contribution_limit
      if (actualPct < expectedPct - 0.1) {
        const remaining = account.annual_contribution_limit - account.ytd_contribution
        const monthlyNeeded = monthsLeft > 0 ? Math.round(remaining / monthsLeft) : remaining
        actions.push({
          priority: 'high',
          type: 'increase_contributions',
          account: account.name,
          message: `Increase to $${monthlyNeeded.toLocaleString()}/mo to max by year-end`,
          dollar_amount: monthlyNeeded,
        })
      }
    }

    actions.sort((a, b) => (a.priority === 'high' ? -1 : 1) - (b.priority === 'high' ? -1 : 1))

    const monthly_plan: string[] = []
    if (monthsLeft > 0 && excess > 0) {
      monthly_plan.push(`Move $${Math.min(excess, 2150).toLocaleString()} excess cash to HSA (if capacity remains)`)
      monthly_plan.push('Increase 401(k) deferral to max by December')
      monthly_plan.push('Invest remainder in brokerage using tax-efficient index funds')
    } else {
      monthly_plan.push('Continue current contribution rates — you\'re on track')
    }

    return {
      total_portfolio: total,
      actions,
      monthly_plan,
      rebalancing_needed: actions.length > 0,
      summary: actions.length === 0
        ? 'All allocations within 2% of target. No rebalancing needed.'
        : `${actions.filter(a => a.priority === 'high').length} high-priority and ${actions.filter(a => a.priority === 'medium').length} medium-priority actions identified.`,
    }
  },
})
