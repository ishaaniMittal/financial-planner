import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { loadProfile, type AssetClass, type AccountTaxTreatment } from '../profile'

interface PlacementRule {
  preferred: AccountTaxTreatment | null
  acceptable: AccountTaxTreatment | null
  avoid: AccountTaxTreatment | null
  reason: string
  tax_drag_factor: number
}

const PLACEMENT_RULES: Record<AssetClass, PlacementRule> = {
  us_bonds: { preferred: 'tax_deferred', acceptable: 'tax_free', avoid: 'taxable', reason: 'Bond income taxed as ordinary income. Sheltering in tax-deferred avoids annual tax drag.', tax_drag_factor: 0.85 },
  intl_bonds: { preferred: 'tax_deferred', acceptable: 'taxable', avoid: null, reason: 'Similar to US bonds but can claim foreign tax credit in taxable.', tax_drag_factor: 0.75 },
  reits: { preferred: 'tax_deferred', acceptable: 'tax_free', avoid: 'taxable', reason: 'REIT dividends are non-qualified and taxed at ordinary income rates.', tax_drag_factor: 0.90 },
  us_equity_large: { preferred: 'tax_free', acceptable: 'taxable', avoid: null, reason: 'Growth stocks are tax-efficient. Roth maximizes tax-free compounding.', tax_drag_factor: 0.20 },
  us_equity_small: { preferred: 'tax_free', acceptable: 'taxable', avoid: null, reason: 'Higher expected returns make Roth ideal for maximum tax-free growth.', tax_drag_factor: 0.30 },
  intl_equity_developed: { preferred: 'taxable', acceptable: 'tax_free', avoid: 'tax_deferred', reason: 'Foreign tax credit only available in taxable accounts.', tax_drag_factor: 0.40 },
  intl_equity_emerging: { preferred: 'taxable', acceptable: 'tax_free', avoid: 'tax_deferred', reason: 'Same as developed international — foreign tax credit is valuable.', tax_drag_factor: 0.45 },
  tips: { preferred: 'tax_deferred', acceptable: 'tax_free', avoid: 'taxable', reason: 'TIPS generate phantom income (inflation adjustments) taxed annually.', tax_drag_factor: 0.80 },
  commodities: { preferred: 'tax_deferred', acceptable: 'tax_free', avoid: 'taxable', reason: 'Commodity funds often generate complex K-1s.', tax_drag_factor: 0.60 },
  crypto: { preferred: 'tax_free', acceptable: 'taxable', avoid: null, reason: 'High growth potential benefits from Roth. In taxable, every swap is a taxable event.', tax_drag_factor: 0.50 },
  cash_equivalent: { preferred: 'cash', acceptable: 'taxable', avoid: 'tax_free', reason: "Don't waste tax-advantaged space on cash.", tax_drag_factor: 0.10 },
}

export const getPlacementRules = tool({
  description: 'Get optimal account placement rules for asset classes. Returns structured data on which account types minimize tax drag for each asset class.',
  inputSchema: zodSchema(z.object({
    asset_class: z.string().optional().describe('Specific asset class to look up. Leave empty to get all.'),
  })),
  execute: async ({ asset_class }) => {
    if (asset_class) {
      const rule = PLACEMENT_RULES[asset_class as AssetClass]
      if (!rule) {
        return {
          error: `Unknown asset class: '${asset_class}'`,
          valid_asset_classes: Object.keys(PLACEMENT_RULES),
        }
      }
      return {
        asset_class,
        preferred: rule.preferred,
        acceptable: rule.acceptable,
        avoid: rule.avoid,
        tax_drag_factor_pct: parseFloat((rule.tax_drag_factor * 100).toFixed(0)),
        reason: rule.reason,
        summary: `${asset_class}: preferred in ${rule.preferred ?? 'any'}, avoid ${rule.avoid ?? 'none'}. Tax drag factor: ${(rule.tax_drag_factor * 100).toFixed(0)}%.`,
      }
    }

    const rules = Object.entries(PLACEMENT_RULES).map(([ac, rule]) => ({
      asset_class: ac,
      preferred: rule.preferred,
      acceptable: rule.acceptable,
      avoid: rule.avoid,
      tax_drag_factor_pct: parseFloat((rule.tax_drag_factor * 100).toFixed(0)),
      reason: rule.reason,
    }))

    return {
      rules,
      principles: [
        'Tax-Deferred (401k/IRA): bonds, REITs, TIPS, commodities — high ordinary income',
        'Tax-Free (Roth): US equities, small-cap, crypto — highest growth potential',
        'Taxable: international equities — claim foreign tax credit',
      ],
      summary: `${rules.length} asset class placement rules. Highest drag: REITs (90%), US bonds (85%), TIPS (80%).`,
    }
  },
})

export const optimizeAssetLocation = tool({
  description: 'Analyze current holdings and recommend optimal placement changes to reduce tax drag. Returns misplacements ranked by severity.',
  inputSchema: zodSchema(z.object({})),
  execute: async () => {
    const profile = loadProfile()

    const misplacements: {
      ticker: string
      account: string
      current_treatment: string
      preferred_treatment: string | null
      severity: 'high' | 'medium'
      tax_drag_factor_pct: number
      reason: string
      action: string
    }[] = []
    const well_placed: { ticker: string; account: string; asset_class: string }[] = []

    for (const account of profile.accounts) {
      if (account.tax_treatment === 'cash') continue
      for (const holding of account.holdings) {
        const rule = PLACEMENT_RULES[holding.asset_class]
        if (!rule) continue
        const current = account.tax_treatment
        if (current === rule.avoid) {
          misplacements.push({
            ticker: holding.ticker,
            account: account.name,
            current_treatment: current,
            preferred_treatment: rule.preferred,
            severity: 'high',
            tax_drag_factor_pct: parseFloat((rule.tax_drag_factor * 100).toFixed(0)),
            reason: rule.reason,
            action: current === 'taxable'
              ? `For new purchases, buy ${holding.ticker} in ${rule.preferred} accounts. Hold existing shares to avoid taxable event.`
              : `Exchange within account or redirect future contributions to ${rule.preferred}.`,
          })
        } else if (current !== rule.preferred && current !== rule.acceptable) {
          misplacements.push({
            ticker: holding.ticker,
            account: account.name,
            current_treatment: current,
            preferred_treatment: rule.preferred,
            severity: 'medium',
            tax_drag_factor_pct: parseFloat((rule.tax_drag_factor * 100).toFixed(0)),
            reason: rule.reason,
            action: `Redirect future contributions of ${holding.ticker} to ${rule.preferred} accounts.`,
          })
        } else {
          well_placed.push({ ticker: holding.ticker, account: account.name, asset_class: holding.asset_class })
        }
      }
    }

    misplacements.sort((a, b) => b.tax_drag_factor_pct - a.tax_drag_factor_pct)

    return {
      total_holdings_analyzed: well_placed.length + misplacements.length,
      misplacements,
      well_placed,
      optimization_needed: misplacements.length > 0,
      summary: misplacements.length === 0
        ? 'All holdings are optimally placed.'
        : `${misplacements.length} suboptimal placement(s) found. ${misplacements.filter(m => m.severity === 'high').length} high severity, ${misplacements.filter(m => m.severity === 'medium').length} medium.`,
    }
  },
})

export const calculateTaxDrag = tool({
  description: 'Calculate the annual tax drag of current holdings. Returns dollar cost of suboptimal account placement per holding.',
  inputSchema: zodSchema(z.object({
    ticker: z.string().optional().describe('Specific ticker to analyze. Leave empty for all holdings.'),
  })),
  execute: async ({ ticker }) => {
    const profile = loadProfile()

    const holdings: {
      ticker: string
      account: string
      tax_treatment: string
      estimated_value: number
      annual_dividends: number
      annual_gains: number
      annual_drag: number
      optimally_placed: boolean
    }[] = []

    let total_annual_drag = 0

    for (const account of profile.accounts) {
      for (const holding of account.holdings) {
        if (ticker && holding.ticker.toUpperCase() !== ticker.toUpperCase()) continue
        const estValue = holding.shares * (holding.cost_basis_per_share > 0 ? holding.cost_basis_per_share : 100)
        const annualDivs = estValue * (holding.dividend_yield / 100)
        const annualGains = estValue * (holding.turnover_rate / 100) * 0.3

        let drag = 0
        if (account.tax_treatment === 'taxable') {
          drag = annualDivs * (profile.tax.marginal_federal_rate + profile.tax.marginal_state_rate) * 0.7
               + annualGains * profile.tax.long_term_cap_gains_rate
        } else if (account.tax_treatment === 'cash') {
          drag = annualDivs * 0.25
        }
        total_annual_drag += drag

        const rule = PLACEMENT_RULES[holding.asset_class]
        const optimally_placed = !rule || account.tax_treatment === rule.preferred || account.tax_treatment === rule.acceptable

        holdings.push({
          ticker: holding.ticker,
          account: account.name,
          tax_treatment: account.tax_treatment,
          estimated_value: Math.round(estValue),
          annual_dividends: Math.round(annualDivs),
          annual_gains: Math.round(annualGains),
          annual_drag: Math.round(drag),
          optimally_placed,
        })
      }
    }

    holdings.sort((a, b) => b.annual_drag - a.annual_drag)

    return {
      holdings,
      total_annual_drag: Math.round(total_annual_drag),
      worst_offenders: holdings.filter(h => !h.optimally_placed && h.annual_drag > 0).slice(0, 3),
      summary: `Total estimated annual tax drag: $${Math.round(total_annual_drag).toLocaleString()}. ${holdings.filter(h => !h.optimally_placed).length} holding(s) suboptimally placed.`,
    }
  },
})

export const analyzeHoldings = tool({
  description: 'Overview of all holdings grouped by asset class. Returns concentration risk, diversification gaps, and total invested.',
  inputSchema: zodSchema(z.object({})),
  execute: async () => {
    const profile = loadProfile()

    const classTotals: Record<string, { value: number; tickers: string[]; accounts: string[] }> = {}
    const tickerTotals: Record<string, { value: number; accounts: string[] }> = {}
    let totalInvested = 0

    for (const account of profile.accounts) {
      if (account.tax_treatment === 'cash') continue
      for (const holding of account.holdings) {
        const estValue = holding.shares * (holding.cost_basis_per_share > 0 ? holding.cost_basis_per_share : 100)
        totalInvested += estValue

        if (!classTotals[holding.asset_class]) classTotals[holding.asset_class] = { value: 0, tickers: [], accounts: [] }
        classTotals[holding.asset_class].value += estValue
        if (!classTotals[holding.asset_class].tickers.includes(holding.ticker))
          classTotals[holding.asset_class].tickers.push(holding.ticker)
        if (!classTotals[holding.asset_class].accounts.includes(account.name))
          classTotals[holding.asset_class].accounts.push(account.name)

        if (!tickerTotals[holding.ticker]) tickerTotals[holding.ticker] = { value: 0, accounts: [] }
        tickerTotals[holding.ticker].value += estValue
        tickerTotals[holding.ticker].accounts.push(account.name)
      }
    }

    const by_asset_class = Object.entries(classTotals)
      .map(([asset_class, data]) => ({
        asset_class,
        value: Math.round(data.value),
        allocation_pct: parseFloat((totalInvested > 0 ? (data.value / totalInvested) * 100 : 0).toFixed(1)),
        tickers: data.tickers,
        accounts: data.accounts,
      }))
      .sort((a, b) => b.value - a.value)

    const concentration_risks = Object.entries(tickerTotals)
      .filter(([, data]) => data.value / totalInvested > 0.15)
      .map(([ticker, data]) => ({
        ticker,
        value: Math.round(data.value),
        allocation_pct: parseFloat(((data.value / totalInvested) * 100).toFixed(1)),
        accounts: data.accounts,
        recommendation: 'Consider diversifying — single holding above 15% threshold',
      }))
      .sort((a, b) => b.value - a.value)

    const core: AssetClass[] = ['us_equity_large', 'intl_equity_developed', 'us_bonds']
    const gaps = core
      .filter(c => !classTotals[c])
      .map(c => ({ missing_asset_class: c, recommendation: `Add ${c.replace(/_/g, ' ')} for core diversification` }))

    return {
      total_invested: Math.round(totalInvested),
      by_asset_class,
      concentration_risks,
      diversification_gaps: gaps,
      summary: `$${Math.round(totalInvested).toLocaleString()} invested across ${by_asset_class.length} asset classes. ${concentration_risks.length} concentration risk(s). ${gaps.length} diversification gap(s).`,
    }
  },
})
