import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { loadProfile, holdingMarketValue, holdingCostBasis, isLongTermGain, type AssetClass, type AccountTaxTreatment } from '../profile'

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
  description: 'Calculate the annual tax drag of current holdings using current market prices. Returns dollar cost of suboptimal account placement per holding.',
  inputSchema: zodSchema(z.object({
    ticker: z.string().optional().describe('Specific ticker to analyze. Leave empty for all holdings.'),
  })),
  execute: async ({ ticker }) => {
    const profile = loadProfile()

    const holdings: {
      ticker: string
      account: string
      tax_treatment: string
      market_value: number
      annual_dividends: number
      annual_realized_gains: number
      annual_drag: number
      optimally_placed: boolean
    }[] = []

    let total_annual_drag = 0

    for (const account of profile.accounts) {
      for (const holding of account.holdings) {
        if (ticker && holding.ticker.toUpperCase() !== ticker.toUpperCase()) continue
        const marketValue = holdingMarketValue(holding)
        const annualDivs = marketValue * (holding.dividend_yield / 100)
        const annualRealizedGains = marketValue * (holding.turnover_rate / 100) * 0.3

        let drag = 0
        if (account.tax_treatment === 'taxable') {
          drag = annualDivs * (profile.tax.marginal_federal_rate + profile.tax.marginal_state_rate) * 0.7
               + annualRealizedGains * profile.tax.long_term_cap_gains_rate
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
          market_value: Math.round(marketValue),
          annual_dividends: Math.round(annualDivs),
          annual_realized_gains: Math.round(annualRealizedGains),
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
  description: 'Rich overview of all holdings: market values, unrealized gains/losses, expense ratios, dividend income, concentration risk, and diversification gaps. Uses current prices when available.',
  inputSchema: zodSchema(z.object({})),
  execute: async () => {
    const profile = loadProfile()
    const now = new Date()

    interface HoldingRow {
      ticker: string
      account: string
      tax_treatment: string
      asset_class: string
      shares: number
      current_price: number
      market_value: number
      cost_basis_total: number | null
      unrealized_gain: number | null
      unrealized_gain_pct: number | null
      is_long_term: boolean | null
      annual_dividend_income: number
      annual_fee_cost: number
      expense_ratio_pct: number
      optimally_placed: boolean
    }

    const rows: HoldingRow[] = []
    const classTotals: Record<string, { market_value: number; tickers: string[]; accounts: string[] }> = {}
    const tickerTotals: Record<string, { market_value: number; cost_basis: number; accounts: string[] }> = {}

    let totalMarketValue = 0
    let totalCostBasis = 0
    let totalCostBasisKnown = 0
    let totalAnnualDividends = 0
    let totalAnnualFees = 0
    let weightedExpenseNumerator = 0

    for (const account of profile.accounts) {
      if (account.tax_treatment === 'cash') continue
      for (const holding of account.holdings) {
        const marketValue = holdingMarketValue(holding)
        const costBasis = holdingCostBasis(holding)
        const unrealizedGain = costBasis !== null ? marketValue - costBasis : null
        const unrealizedGainPct = costBasis !== null && costBasis > 0
          ? parseFloat(((marketValue - costBasis) / costBasis * 100).toFixed(1))
          : null
        const longTerm = isLongTermGain(holding, now)
        const annualDividends = marketValue * (holding.dividend_yield / 100)
        const annualFees = marketValue * (holding.expense_ratio / 100)
        const rule = PLACEMENT_RULES[holding.asset_class]
        const optimallyPlaced = !rule || account.tax_treatment === rule.preferred || account.tax_treatment === rule.acceptable

        totalMarketValue += marketValue
        if (costBasis !== null) { totalCostBasis += costBasis; totalCostBasisKnown += marketValue }
        totalAnnualDividends += annualDividends
        totalAnnualFees += annualFees
        weightedExpenseNumerator += marketValue * holding.expense_ratio

        if (!classTotals[holding.asset_class]) classTotals[holding.asset_class] = { market_value: 0, tickers: [], accounts: [] }
        classTotals[holding.asset_class].market_value += marketValue
        if (!classTotals[holding.asset_class].tickers.includes(holding.ticker)) classTotals[holding.asset_class].tickers.push(holding.ticker)
        if (!classTotals[holding.asset_class].accounts.includes(account.name)) classTotals[holding.asset_class].accounts.push(account.name)

        if (!tickerTotals[holding.ticker]) tickerTotals[holding.ticker] = { market_value: 0, cost_basis: 0, accounts: [] }
        tickerTotals[holding.ticker].market_value += marketValue
        if (costBasis !== null) tickerTotals[holding.ticker].cost_basis += costBasis
        tickerTotals[holding.ticker].accounts.push(account.name)

        rows.push({
          ticker: holding.ticker,
          account: account.name,
          tax_treatment: account.tax_treatment,
          asset_class: holding.asset_class,
          shares: holding.shares,
          current_price: holding.current_price > 0 ? holding.current_price : holding.cost_basis_per_share,
          market_value: Math.round(marketValue),
          cost_basis_total: costBasis !== null ? Math.round(costBasis) : null,
          unrealized_gain: unrealizedGain !== null ? Math.round(unrealizedGain) : null,
          unrealized_gain_pct: unrealizedGainPct,
          is_long_term: longTerm,
          annual_dividend_income: Math.round(annualDividends),
          annual_fee_cost: Math.round(annualFees),
          expense_ratio_pct: holding.expense_ratio,
          optimally_placed: optimallyPlaced,
        })
      }
    }

    const by_asset_class = Object.entries(classTotals)
      .map(([asset_class, data]) => ({
        asset_class,
        market_value: Math.round(data.market_value),
        allocation_pct: parseFloat((totalMarketValue > 0 ? data.market_value / totalMarketValue * 100 : 0).toFixed(1)),
        tickers: data.tickers,
        accounts: data.accounts,
      }))
      .sort((a, b) => b.market_value - a.market_value)

    const concentration_risks = Object.entries(tickerTotals)
      .filter(([, data]) => data.market_value / totalMarketValue > 0.15)
      .map(([ticker, data]) => ({
        ticker,
        market_value: Math.round(data.market_value),
        allocation_pct: parseFloat((data.market_value / totalMarketValue * 100).toFixed(1)),
        unrealized_gain: data.cost_basis > 0 ? Math.round(data.market_value - data.cost_basis) : null,
        accounts: data.accounts,
        note: 'Single holding above 15% of invested portfolio',
      }))
      .sort((a, b) => b.market_value - a.market_value)

    const core: AssetClass[] = ['us_equity_large', 'intl_equity_developed', 'us_bonds']
    const diversification_gaps = core
      .filter(c => !classTotals[c])
      .map(c => ({ missing_asset_class: c, recommendation: `Add ${c.replace(/_/g, ' ')} for core diversification` }))

    const totalUnrealizedGain = rows.reduce((s, r) => s + (r.unrealized_gain ?? 0), 0)
    const weightedAvgExpenseRatio = totalMarketValue > 0 ? parseFloat((weightedExpenseNumerator / totalMarketValue).toFixed(4)) : 0

    return {
      total_market_value: Math.round(totalMarketValue),
      total_cost_basis: Math.round(totalCostBasis),
      total_unrealized_gain: Math.round(totalUnrealizedGain),
      total_unrealized_gain_pct: totalCostBasis > 0
        ? parseFloat((totalUnrealizedGain / totalCostBasis * 100).toFixed(1))
        : null,
      total_annual_dividend_income: Math.round(totalAnnualDividends),
      total_annual_fees: Math.round(totalAnnualFees),
      weighted_avg_expense_ratio_pct: parseFloat((weightedAvgExpenseRatio * 100).toFixed(3)),
      holdings: rows.sort((a, b) => b.market_value - a.market_value),
      by_asset_class,
      concentration_risks,
      diversification_gaps,
      summary: `$${Math.round(totalMarketValue).toLocaleString()} total market value. Unrealized gain: $${Math.round(totalUnrealizedGain).toLocaleString()}. Annual dividends: $${Math.round(totalAnnualDividends).toLocaleString()}. Weighted expense ratio: ${(weightedAvgExpenseRatio * 100).toFixed(3)}%. ${concentration_risks.length} concentration risk(s), ${diversification_gaps.length} gap(s).`,
    }
  },
})

export const analyzeTaxOpportunities = tool({
  description: 'Identify tax optimization opportunities: tax-loss harvesting candidates, large taxable gains, employer stock concentration, and ESPP holding period analysis.',
  inputSchema: zodSchema(z.object({})),
  execute: async () => {
    const profile = loadProfile()
    const now = new Date()

    const tax_loss_candidates: {
      ticker: string; account: string; market_value: number
      unrealized_loss: number; unrealized_loss_pct: number; is_long_term: boolean | null
      wash_sale_warning: string
    }[] = []

    const large_taxable_gains: {
      ticker: string; account: string; market_value: number
      unrealized_gain: number; unrealized_gain_pct: number; is_long_term: boolean | null
      note: string
    }[] = []

    const employer_stock: {
      ticker: string; account: string; market_value: number; allocation_pct: number
      purchase_date: string | undefined; is_long_term: boolean | null
      espp_note: string
    }[] = []

    let totalInvested = 0
    for (const account of profile.accounts) {
      if (account.tax_treatment === 'cash') continue
      for (const h of account.holdings) totalInvested += holdingMarketValue(h)
    }

    for (const account of profile.accounts) {
      if (account.tax_treatment !== 'taxable') continue
      for (const holding of account.holdings) {
        const marketValue = holdingMarketValue(holding)
        const costBasis = holdingCostBasis(holding)
        if (costBasis === null) continue
        const gain = marketValue - costBasis
        const gainPct = parseFloat((gain / costBasis * 100).toFixed(1))
        const longTerm = isLongTermGain(holding, now)

        if (gain < -500) {
          tax_loss_candidates.push({
            ticker: holding.ticker,
            account: account.name,
            market_value: Math.round(marketValue),
            unrealized_loss: Math.round(gain),
            unrealized_loss_pct: gainPct,
            is_long_term: longTerm,
            wash_sale_warning: `Avoid buying ${holding.ticker} or a substantially identical fund 30 days before/after harvesting.`,
          })
        }

        if (gain > 5000) {
          large_taxable_gains.push({
            ticker: holding.ticker,
            account: account.name,
            market_value: Math.round(marketValue),
            unrealized_gain: Math.round(gain),
            unrealized_gain_pct: gainPct,
            is_long_term: longTerm,
            note: longTerm === false
              ? 'Short-term gain — taxed as ordinary income. Consider holding past 1-year mark.'
              : longTerm === true
              ? `Long-term gain — qualifies for ${(profile.tax.long_term_cap_gains_rate * 100).toFixed(0)}% LTCG rate.`
              : 'Holding period unknown.',
          })
        }

        // Flag employer/ESPP stock
        if (account.id === 'espp' || account.tax_treatment === 'taxable') {
          const alloc = marketValue / totalInvested
          if (alloc > 0.05) {
            const days = holding.purchase_date
              ? Math.floor((now.getTime() - new Date(holding.purchase_date).getTime()) / 86400000)
              : null
            const isQualifying = days !== null && days >= 730  // 2-year ESPP qualifying disposition rule
            employer_stock.push({
              ticker: holding.ticker,
              account: account.name,
              market_value: Math.round(marketValue),
              allocation_pct: parseFloat((alloc * 100).toFixed(1)),
              purchase_date: holding.purchase_date,
              is_long_term: longTerm,
              espp_note: account.id === 'espp'
                ? isQualifying
                  ? 'Qualifying disposition (held 2+ years): gain taxed at favorable LTCG rates.'
                  : days !== null
                    ? `Disqualifying disposition (held ${days} days, need 730): gain taxed as ordinary income. Consider holding longer.`
                    : 'ESPP holding period unknown — track to determine qualifying vs disqualifying disposition.'
                : `Employer stock at ${(alloc * 100).toFixed(1)}% of portfolio — concentrated single-stock risk.`,
            })
          }
        }
      }
    }

    const opportunities: string[] = []
    if (tax_loss_candidates.length) opportunities.push(`${tax_loss_candidates.length} tax-loss harvesting candidate(s)`)
    if (large_taxable_gains.length) opportunities.push(`${large_taxable_gains.length} holding(s) with large taxable gains to plan around`)
    if (employer_stock.length) opportunities.push(`${employer_stock.length} employer/ESPP stock position(s) to review`)

    return {
      tax_loss_candidates,
      large_taxable_gains,
      employer_stock,
      opportunities_found: opportunities.length > 0,
      summary: opportunities.length === 0
        ? 'No significant tax opportunities identified in taxable accounts.'
        : opportunities.join('; ') + '.',
    }
  },
})
