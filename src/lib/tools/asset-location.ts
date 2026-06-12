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
  description: 'Get the optimal account placement rules for asset classes. Explains WHY each asset class should go in specific account types to minimize tax drag.',
  inputSchema: zodSchema(z.object({
    asset_class: z.string().optional().describe('Specific asset class to look up (e.g. "us_bonds"). Leave empty to see all.'),
  })),
  execute: async ({ asset_class }) => {
    const lines: string[] = ['=== Asset Location Placement Rules ===\n']
    lines.push('Principle: Place tax-INefficient assets in tax-sheltered accounts.\n')

    if (asset_class) {
      const rule = PLACEMENT_RULES[asset_class as AssetClass]
      if (!rule) return `Unknown asset class: '${asset_class}'. Valid: ${Object.keys(PLACEMENT_RULES).join(', ')}`
      lines.push(`Asset Class: ${asset_class}`)
      lines.push(`  Preferred Account: ${rule.preferred ?? 'Any'}`)
      lines.push(`  Acceptable: ${rule.acceptable ?? 'Any'}`)
      lines.push(`  Avoid: ${rule.avoid ?? 'None'}`)
      lines.push(`  Tax Drag Factor: ${(rule.tax_drag_factor * 100).toFixed(0)}%`)
      lines.push(`  Rationale: ${rule.reason}`)
    } else {
      lines.push(`${'Asset Class'.padEnd(25)} ${'Preferred'.padEnd(15)} ${'Acceptable'.padEnd(15)} ${'Avoid'.padEnd(15)} Drag`)
      lines.push('-'.repeat(80))
      for (const [ac, rule] of Object.entries(PLACEMENT_RULES)) {
        lines.push(
          `  ${ac.padEnd(23)} ${(rule.preferred ?? 'Any').padEnd(15)} ${(rule.acceptable ?? 'Any').padEnd(15)} ${(rule.avoid ?? '—').padEnd(15)} ${(rule.tax_drag_factor * 100).toFixed(0)}%`
        )
      }
      lines.push('\nSummary:')
      lines.push('  Tax-Deferred: Bonds, REITs, TIPS, Commodities')
      lines.push('  Tax-Free (Roth): US equities, small-cap, crypto')
      lines.push('  Taxable: International equities (foreign tax credit)')
    }
    return lines.join('\n')
  },
})

export const optimizeAssetLocation = tool({
  description: 'Analyze current holdings and recommend optimal placement changes to reduce tax drag.',
  inputSchema: zodSchema(z.object({})),
  execute: async () => {
    const profile = loadProfile()
    const lines: string[] = ['=== Asset Location Optimization ===\n']

    const misplacements: { ticker: string; accountName: string; current: string; preferred: string | null; severity: string; reason: string; dragFactor: number }[] = []
    const wellPlaced: string[] = []

    for (const account of profile.accounts) {
      if (account.tax_treatment === 'cash') continue
      for (const holding of account.holdings) {
        const rule = PLACEMENT_RULES[holding.asset_class]
        if (!rule) continue
        const current = account.tax_treatment
        if (current === rule.avoid) {
          misplacements.push({ ticker: holding.ticker, accountName: account.name, current, preferred: rule.preferred, severity: 'HIGH', reason: rule.reason, dragFactor: rule.tax_drag_factor })
        } else if (current !== rule.preferred && current !== rule.acceptable) {
          misplacements.push({ ticker: holding.ticker, accountName: account.name, current, preferred: rule.preferred, severity: 'MEDIUM', reason: rule.reason, dragFactor: rule.tax_drag_factor })
        } else {
          wellPlaced.push(holding.ticker)
        }
      }
    }

    lines.push(`Analyzed ${wellPlaced.length + misplacements.length} holdings.\n`)
    if (!misplacements.length) { lines.push('All holdings are optimally placed.'); return lines.join('\n') }

    lines.push(`Found ${misplacements.length} suboptimal placements:\n`)
    misplacements.sort((a, b) => b.dragFactor - a.dragFactor)

    for (let i = 0; i < misplacements.length; i++) {
      const mp = misplacements[i]
      lines.push(`  ${i + 1}. [${mp.severity}] ${mp.ticker} (${mp.current})`)
      lines.push(`     Currently in: ${mp.accountName}`)
      lines.push(`     Should be in: ${mp.preferred ?? 'Any'}`)
      lines.push(`     Reason: ${mp.reason}\n`)
    }

    lines.push('--- Suggested Moves ---')
    for (const mp of misplacements) {
      if (mp.current === 'taxable') {
        lines.push(`  ${mp.ticker}: For NEW purchases, buy in ${mp.preferred} accounts. Hold existing shares.`)
      } else {
        lines.push(`  ${mp.ticker}: Exchange within account or redirect future contributions to ${mp.preferred}.`)
      }
    }
    return lines.join('\n')
  },
})

export const calculateTaxDrag = tool({
  description: 'Calculate the annual tax drag of current holdings. Shows dollar cost of suboptimal account placement.',
  inputSchema: zodSchema(z.object({
    ticker: z.string().optional().describe('Specific ticker to analyze. Leave empty for all holdings.'),
  })),
  execute: async ({ ticker }) => {
    const profile = loadProfile()
    const lines: string[] = ['=== Tax Drag Analysis ===\n']
    lines.push(`${'Ticker'.padEnd(8)} ${'Account'.padEnd(22)} ${'Value'.padStart(10)} ${'Div Yield'.padStart(10)} ${'Tax Drag'.padStart(10)} ${'Optimal?'.padStart(8)}`)
    lines.push('-'.repeat(75))

    let totalDrag = 0
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
        totalDrag += drag

        const rule = PLACEMENT_RULES[holding.asset_class]
        const optimal = rule && (account.tax_treatment === rule.preferred || account.tax_treatment === rule.acceptable) ? '✓' : '✗'
        lines.push(`  ${holding.ticker.padEnd(6)} ${account.name.padEnd(22)} $${estValue.toLocaleString().padStart(8)} ${holding.dividend_yield.toFixed(1).padStart(8)}% $${Math.round(drag).toLocaleString().padStart(8)} ${optimal.padStart(6)}`)
      }
    }

    lines.push('-'.repeat(75))
    lines.push(`  Total estimated annual tax drag: $${Math.round(totalDrag).toLocaleString()}`)
    return lines.join('\n')
  },
})

export const analyzeHoldings = tool({
  description: 'Overview of all holdings grouped by asset class. Shows concentration risk and diversification gaps.',
  inputSchema: zodSchema(z.object({})),
  execute: async () => {
    const profile = loadProfile()
    const lines: string[] = ['=== Holdings Analysis ===\n']

    const classTotals: Record<string, { value: number; tickers: string[] }> = {}
    let totalInvested = 0

    for (const account of profile.accounts) {
      if (account.tax_treatment === 'cash') continue
      for (const holding of account.holdings) {
        const estValue = holding.shares * (holding.cost_basis_per_share > 0 ? holding.cost_basis_per_share : 100)
        totalInvested += estValue
        if (!classTotals[holding.asset_class]) classTotals[holding.asset_class] = { value: 0, tickers: [] }
        classTotals[holding.asset_class].value += estValue
        classTotals[holding.asset_class].tickers.push(holding.ticker)
      }
    }

    lines.push(`Total Invested (excl. cash): $${totalInvested.toLocaleString()}\n`)
    lines.push(`${'Asset Class'.padEnd(25)} ${'Value'.padStart(12)} ${'Allocation'.padStart(12)} ${'Holdings'.padStart(10)}`)
    lines.push('-'.repeat(65))

    for (const [ac, data] of Object.entries(classTotals).sort((a, b) => b[1].value - a[1].value)) {
      const pct = totalInvested > 0 ? (data.value / totalInvested) * 100 : 0
      lines.push(`  ${ac.padEnd(23)} $${data.value.toLocaleString().padStart(10)} ${pct.toFixed(1).padStart(10)}% ${data.tickers.length.toString().padStart(8)}`)
    }

    lines.push('\n--- Concentration Risks ---')
    const tickerTotals: Record<string, number> = {}
    for (const account of profile.accounts) {
      for (const h of account.holdings) {
        const v = h.shares * (h.cost_basis_per_share > 0 ? h.cost_basis_per_share : 100)
        tickerTotals[h.ticker] = (tickerTotals[h.ticker] ?? 0) + v
      }
    }
    const concentrated = Object.entries(tickerTotals).filter(([, v]) => v / totalInvested > 0.15)
    if (concentrated.length) {
      for (const [t, v] of concentrated.sort((a, b) => b[1] - a[1])) {
        lines.push(`  ${t}: $${v.toLocaleString()} (${((v / totalInvested) * 100).toFixed(1)}%) — consider diversifying above 15%`)
      }
    } else {
      lines.push('  No single holding exceeds 15% of portfolio.')
    }

    lines.push('\n--- Diversification Gaps ---')
    const core: AssetClass[] = ['us_equity_large', 'intl_equity_developed', 'us_bonds']
    const missing = core.filter(c => !classTotals[c])
    if (missing.length) {
      for (const c of missing) lines.push(`  Missing: ${c} — consider adding for diversification`)
    } else {
      lines.push('  Core asset classes all represented.')
    }

    return lines.join('\n')
  },
})
