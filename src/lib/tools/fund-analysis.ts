/**
 * Fund metadata is hardcoded. See TECH_DEBT.md for the plan to replace this
 * with a live financial data API.
 */
import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { loadProfile, holdingMarketValue } from '../profile'

interface FundInfo {
  ticker: string
  name: string
  issuer: string
  asset_class: string
  expense_ratio: number          // annual %, e.g. 0.03 = 0.03%
  index_tracked?: string
  cheaper_alternatives?: string[] // tickers with lower ER doing same job
  overlaps_with?: string[]        // substantially similar funds
}

// ~60 commonly held retail ETFs and mutual funds
const FUND_DB: Record<string, FundInfo> = {
  // --- US Total Market ---
  VTI:   { ticker: 'VTI',   name: 'Vanguard Total Stock Market ETF',           issuer: 'Vanguard',  asset_class: 'us_equity_large', expense_ratio: 0.03, index_tracked: 'CRSP US Total Market',     overlaps_with: ['VTSAX','FSKAX','SWTSX','ITOT','SCHB','FZROX'] },
  VTSAX: { ticker: 'VTSAX', name: 'Vanguard Total Stock Market Index Fund',     issuer: 'Vanguard',  asset_class: 'us_equity_large', expense_ratio: 0.04, index_tracked: 'CRSP US Total Market',     cheaper_alternatives: ['VTI'], overlaps_with: ['VTI','FSKAX','SWTSX','ITOT','SCHB'] },
  FSKAX: { ticker: 'FSKAX', name: 'Fidelity Total Market Index Fund',           issuer: 'Fidelity',  asset_class: 'us_equity_large', expense_ratio: 0.015,index_tracked: 'Fidelity US Total Investable Market', overlaps_with: ['VTI','VTSAX','SWTSX','ITOT','SCHB'] },
  FZROX: { ticker: 'FZROX', name: 'Fidelity ZERO Total Market Index Fund',      issuer: 'Fidelity',  asset_class: 'us_equity_large', expense_ratio: 0.0,  index_tracked: 'Fidelity US Total Investable Market', overlaps_with: ['VTI','FSKAX'], cheaper_alternatives: [] },
  ITOT:  { ticker: 'ITOT',  name: 'iShares Core S&P Total US Stock Market ETF', issuer: 'BlackRock', asset_class: 'us_equity_large', expense_ratio: 0.03, index_tracked: 'S&P Total Market',         overlaps_with: ['VTI','VTSAX','FSKAX','SCHB'] },
  SCHB:  { ticker: 'SCHB',  name: 'Schwab US Broad Market ETF',                 issuer: 'Schwab',    asset_class: 'us_equity_large', expense_ratio: 0.03, index_tracked: 'Dow Jones US Broad Stock Market', overlaps_with: ['VTI','ITOT','FSKAX'] },
  SWTSX: { ticker: 'SWTSX', name: 'Schwab Total Stock Market Index Fund',        issuer: 'Schwab',    asset_class: 'us_equity_large', expense_ratio: 0.03, index_tracked: 'Dow Jones US Broad Stock Market', overlaps_with: ['VTI','VTSAX','FSKAX'] },

  // --- US Large Cap / S&P 500 ---
  VOO:   { ticker: 'VOO',   name: 'Vanguard S&P 500 ETF',                        issuer: 'Vanguard',  asset_class: 'us_equity_large', expense_ratio: 0.03, index_tracked: 'S&P 500', overlaps_with: ['SPY','IVV','FXAIX','VFIAX','SWPPX'] },
  SPY:   { ticker: 'SPY',   name: 'SPDR S&P 500 ETF Trust',                      issuer: 'SSGA',      asset_class: 'us_equity_large', expense_ratio: 0.0945,index_tracked: 'S&P 500', cheaper_alternatives: ['VOO','IVV','FXAIX'], overlaps_with: ['VOO','IVV','FXAIX','VFIAX'] },
  IVV:   { ticker: 'IVV',   name: 'iShares Core S&P 500 ETF',                    issuer: 'BlackRock', asset_class: 'us_equity_large', expense_ratio: 0.03, index_tracked: 'S&P 500', overlaps_with: ['VOO','SPY','FXAIX','VFIAX'] },
  FXAIX: { ticker: 'FXAIX', name: 'Fidelity 500 Index Fund',                     issuer: 'Fidelity',  asset_class: 'us_equity_large', expense_ratio: 0.015,index_tracked: 'S&P 500', overlaps_with: ['VOO','IVV','SPY','VFIAX'] },
  VFIAX: { ticker: 'VFIAX', name: 'Vanguard 500 Index Fund Admiral Shares',      issuer: 'Vanguard',  asset_class: 'us_equity_large', expense_ratio: 0.04, index_tracked: 'S&P 500', cheaper_alternatives: ['VOO','IVV','FXAIX'], overlaps_with: ['VOO','SPY','IVV'] },
  SWPPX: { ticker: 'SWPPX', name: 'Schwab S&P 500 Index Fund',                   issuer: 'Schwab',    asset_class: 'us_equity_large', expense_ratio: 0.02, index_tracked: 'S&P 500', overlaps_with: ['VOO','IVV','FXAIX'] },

  // --- US Large Cap Growth / Tech ---
  VGT:   { ticker: 'VGT',   name: 'Vanguard Information Technology ETF',         issuer: 'Vanguard',  asset_class: 'us_equity_large', expense_ratio: 0.10, index_tracked: 'MSCI US IMI IT 25/50',    overlaps_with: ['QQQ','XLK'] },
  QQQ:   { ticker: 'QQQ',   name: 'Invesco QQQ Trust',                           issuer: 'Invesco',   asset_class: 'us_equity_large', expense_ratio: 0.20, index_tracked: 'Nasdaq-100',              cheaper_alternatives: ['QQQM'], overlaps_with: ['VGT','QQQM','XLK'] },
  QQQM:  { ticker: 'QQQM',  name: 'Invesco Nasdaq-100 ETF',                      issuer: 'Invesco',   asset_class: 'us_equity_large', expense_ratio: 0.15, index_tracked: 'Nasdaq-100',              overlaps_with: ['QQQ','VGT'] },
  XLK:   { ticker: 'XLK',   name: 'Technology Select Sector SPDR Fund',          issuer: 'SSGA',      asset_class: 'us_equity_large', expense_ratio: 0.09, index_tracked: 'S&P Tech Sector',         overlaps_with: ['VGT','QQQ'] },

  // --- US Small Cap ---
  VB:    { ticker: 'VB',    name: 'Vanguard Small-Cap ETF',                      issuer: 'Vanguard',  asset_class: 'us_equity_small', expense_ratio: 0.05, index_tracked: 'CRSP US Small Cap',       overlaps_with: ['VSMAX','IJR','SCHA'] },
  VSMAX: { ticker: 'VSMAX', name: 'Vanguard Small-Cap Index Fund Admiral',        issuer: 'Vanguard',  asset_class: 'us_equity_small', expense_ratio: 0.05, index_tracked: 'CRSP US Small Cap',       cheaper_alternatives: ['VB'], overlaps_with: ['VB','IJR'] },
  IJR:   { ticker: 'IJR',   name: 'iShares Core S&P Small-Cap ETF',              issuer: 'BlackRock', asset_class: 'us_equity_small', expense_ratio: 0.06, index_tracked: 'S&P SmallCap 600',        overlaps_with: ['VB','SCHA'] },
  SCHA:  { ticker: 'SCHA',  name: 'Schwab US Small-Cap ETF',                     issuer: 'Schwab',    asset_class: 'us_equity_small', expense_ratio: 0.04, index_tracked: 'Dow Jones US Small-Cap',  overlaps_with: ['VB','IJR'] },

  // --- International Developed ---
  VXUS:  { ticker: 'VXUS',  name: 'Vanguard Total International Stock ETF',      issuer: 'Vanguard',  asset_class: 'intl_equity_developed', expense_ratio: 0.07, index_tracked: 'FTSE Global All Cap ex US', overlaps_with: ['VTIAX','IXUS','SWISX'] },
  VTIAX: { ticker: 'VTIAX', name: 'Vanguard Total Intl Stock Index Fund Admiral', issuer: 'Vanguard',  asset_class: 'intl_equity_developed', expense_ratio: 0.11, index_tracked: 'FTSE Global All Cap ex US', cheaper_alternatives: ['VXUS'], overlaps_with: ['VXUS','IXUS'] },
  IXUS:  { ticker: 'IXUS',  name: 'iShares Core MSCI Total International ETF',   issuer: 'BlackRock', asset_class: 'intl_equity_developed', expense_ratio: 0.07, index_tracked: 'MSCI ACWI ex USA IMI',      overlaps_with: ['VXUS','VTIAX'] },
  VEA:   { ticker: 'VEA',   name: 'Vanguard FTSE Developed Markets ETF',         issuer: 'Vanguard',  asset_class: 'intl_equity_developed', expense_ratio: 0.05, index_tracked: 'FTSE Developed All Cap ex US', overlaps_with: ['IEFA','SWISX'] },
  IEFA:  { ticker: 'IEFA',  name: 'iShares Core MSCI EAFE ETF',                  issuer: 'BlackRock', asset_class: 'intl_equity_developed', expense_ratio: 0.07, index_tracked: 'MSCI EAFE IMI',             overlaps_with: ['VEA'] },
  SWISX: { ticker: 'SWISX', name: 'Schwab International Index Fund',              issuer: 'Schwab',    asset_class: 'intl_equity_developed', expense_ratio: 0.06, index_tracked: 'MSCI EAFE',                  overlaps_with: ['VEA','IEFA'] },

  // --- International Emerging ---
  VWO:   { ticker: 'VWO',   name: 'Vanguard FTSE Emerging Markets ETF',          issuer: 'Vanguard',  asset_class: 'intl_equity_emerging', expense_ratio: 0.08, index_tracked: 'FTSE Emerging Markets', overlaps_with: ['IEMG','EEM'] },
  IEMG:  { ticker: 'IEMG',  name: 'iShares Core MSCI Emerging Markets ETF',      issuer: 'BlackRock', asset_class: 'intl_equity_emerging', expense_ratio: 0.09, index_tracked: 'MSCI EM IMI',           overlaps_with: ['VWO','EEM'] },
  EEM:   { ticker: 'EEM',   name: 'iShares MSCI Emerging Markets ETF',           issuer: 'BlackRock', asset_class: 'intl_equity_emerging', expense_ratio: 0.70, index_tracked: 'MSCI EM',               cheaper_alternatives: ['VWO','IEMG'], overlaps_with: ['VWO','IEMG'] },

  // --- US Bonds ---
  BND:   { ticker: 'BND',   name: 'Vanguard Total Bond Market ETF',              issuer: 'Vanguard',  asset_class: 'us_bonds', expense_ratio: 0.03, index_tracked: 'Bloomberg US Aggregate Float Adjusted', overlaps_with: ['VBTLX','AGG','SCHZ'] },
  VBTLX: { ticker: 'VBTLX', name: 'Vanguard Total Bond Market Index Fund Admiral',issuer: 'Vanguard',  asset_class: 'us_bonds', expense_ratio: 0.05, index_tracked: 'Bloomberg US Aggregate Float Adjusted', cheaper_alternatives: ['BND'], overlaps_with: ['BND','AGG','SCHZ'] },
  AGG:   { ticker: 'AGG',   name: 'iShares Core US Aggregate Bond ETF',          issuer: 'BlackRock', asset_class: 'us_bonds', expense_ratio: 0.03, index_tracked: 'Bloomberg US Aggregate',              overlaps_with: ['BND','VBTLX','SCHZ'] },
  SCHZ:  { ticker: 'SCHZ',  name: 'Schwab US Aggregate Bond ETF',                issuer: 'Schwab',    asset_class: 'us_bonds', expense_ratio: 0.03, index_tracked: 'Bloomberg US Aggregate',              overlaps_with: ['BND','AGG','VBTLX'] },
  VBIRX: { ticker: 'VBIRX', name: 'Vanguard Short-Term Bond Index Fund Admiral', issuer: 'Vanguard',  asset_class: 'us_bonds', expense_ratio: 0.07, index_tracked: 'Bloomberg US 1-5 Year Gov/Credit',   overlaps_with: ['BSV','SCHO'] },
  BSV:   { ticker: 'BSV',   name: 'Vanguard Short-Term Bond ETF',                issuer: 'Vanguard',  asset_class: 'us_bonds', expense_ratio: 0.04, index_tracked: 'Bloomberg US 1-5 Year Gov/Credit',   cheaper_alternatives: [], overlaps_with: ['VBIRX','SCHO'] },
  SCHO:  { ticker: 'SCHO',  name: 'Schwab Short-Term US Treasury ETF',           issuer: 'Schwab',    asset_class: 'us_bonds', expense_ratio: 0.03, index_tracked: 'Bloomberg US Treasury 1-3 Year',    overlaps_with: ['BSV','VBIRX'] },

  // --- International Bonds ---
  BNDX:  { ticker: 'BNDX',  name: 'Vanguard Total International Bond ETF',       issuer: 'Vanguard',  asset_class: 'intl_bonds', expense_ratio: 0.07, index_tracked: 'Bloomberg Global Aggregate ex USD (Hedged)' },
  IAGG:  { ticker: 'IAGG',  name: 'iShares Core International Aggregate Bond ETF',issuer: 'BlackRock', asset_class: 'intl_bonds', expense_ratio: 0.06, index_tracked: 'Bloomberg Global Aggregate ex USD (Hedged)', overlaps_with: ['BNDX'] },

  // --- TIPS ---
  VTIP:  { ticker: 'VTIP',  name: 'Vanguard Short-Term Inflation-Protected ETF', issuer: 'Vanguard',  asset_class: 'tips', expense_ratio: 0.04, index_tracked: 'Bloomberg US Treasury Inflation-Protected 0-5 Yr' },
  SCHP:  { ticker: 'SCHP',  name: 'Schwab US TIPS ETF',                          issuer: 'Schwab',    asset_class: 'tips', expense_ratio: 0.03, index_tracked: 'Bloomberg US TIPS',                           overlaps_with: ['TIP'] },
  TIP:   { ticker: 'TIP',   name: 'iShares TIPS Bond ETF',                       issuer: 'BlackRock', asset_class: 'tips', expense_ratio: 0.19, index_tracked: 'Bloomberg US TIPS',                           cheaper_alternatives: ['SCHP'], overlaps_with: ['SCHP'] },

  // --- REITs ---
  VNQ:   { ticker: 'VNQ',   name: 'Vanguard Real Estate ETF',                    issuer: 'Vanguard',  asset_class: 'reits', expense_ratio: 0.12, index_tracked: 'MSCI US Investable Market Real Estate 25/50', overlaps_with: ['SCHH','IYR'] },
  SCHH:  { ticker: 'SCHH',  name: 'Schwab US REIT ETF',                          issuer: 'Schwab',    asset_class: 'reits', expense_ratio: 0.07, index_tracked: 'Dow Jones US Select REIT',                   overlaps_with: ['VNQ'] },
  IYR:   { ticker: 'IYR',   name: 'iShares US Real Estate ETF',                  issuer: 'BlackRock', asset_class: 'reits', expense_ratio: 0.40, index_tracked: 'Dow Jones US Real Estate',                   cheaper_alternatives: ['VNQ','SCHH'], overlaps_with: ['VNQ','SCHH'] },

  // --- Target Date ---
  VTTSX: { ticker: 'VTTSX', name: 'Vanguard Target Retirement 2060 Fund',        issuer: 'Vanguard',  asset_class: 'us_equity_large', expense_ratio: 0.08 },
  FFNOX: { ticker: 'FFNOX', name: 'Fidelity Freedom Index 2050 Fund',            issuer: 'Fidelity',  asset_class: 'us_equity_large', expense_ratio: 0.12 },
}

// ---------------------------------------------------------------------------
// analyze_fund_overlap
// ---------------------------------------------------------------------------

export const analyzeFundOverlap = tool({
  description: `Detect fund overlap and high-fee substitution opportunities in the portfolio.
Identifies holdings that track the same index (redundant diversification), suggests
cheaper alternatives for the same exposure, and calculates the annual fee savings from switching.
Uses a hardcoded database of ~60 common ETFs and mutual funds.`,
  inputSchema: zodSchema(z.object({
    ticker: z.string().optional().describe('Analyze a specific ticker. Leave empty to scan the whole portfolio.'),
  })),
  execute: async ({ ticker }) => {
    const profile = loadProfile()

    // Gather all held tickers with market values
    const held: Record<string, { market_value: number; accounts: string[]; expense_ratio: number }> = {}
    for (const account of profile.accounts) {
      for (const h of account.holdings) {
        const t = h.ticker.toUpperCase()
        if (ticker && t !== ticker.toUpperCase()) continue
        const val = holdingMarketValue(h)
        if (!held[t]) held[t] = { market_value: 0, accounts: [], expense_ratio: h.expense_ratio }
        held[t].market_value += val
        held[t].accounts.push(account.name)
        // Use profile expense ratio if db doesn't have it
        if (FUND_DB[t]) held[t].expense_ratio = FUND_DB[t].expense_ratio
      }
    }

    const totalPortfolio = Object.values(held).reduce((s, h) => s + h.market_value, 0)

    // Overlap groups: funds that substantially overlap
    const overlapGroups: { funds: string[]; market_value: number; note: string }[] = []
    const flagged = new Set<string>()

    for (const [t, data] of Object.entries(held)) {
      if (flagged.has(t)) continue
      const info = FUND_DB[t]
      if (!info?.overlaps_with) continue
      const heldOverlaps = info.overlaps_with.filter(o => held[o])
      if (!heldOverlaps.length) continue

      const group = [t, ...heldOverlaps]
      const groupValue = group.reduce((s, f) => s + (held[f]?.market_value ?? 0), 0)
      overlapGroups.push({
        funds: group,
        market_value: Math.round(groupValue),
        note: `${group.join(' + ')} track substantially the same index. Holding multiples adds no diversification — consolidate into one.`,
      })
      group.forEach(f => flagged.add(f))
    }

    // Fee substitution opportunities
    const substitutions: {
      held_ticker: string
      held_er_pct: number
      alternative_ticker: string
      alternative_er_pct: number
      annual_savings: number
      market_value: number
      note: string
    }[] = []

    for (const [t, data] of Object.entries(held)) {
      const info = FUND_DB[t]
      if (!info?.cheaper_alternatives?.length) continue
      for (const alt of info.cheaper_alternatives) {
        const altInfo = FUND_DB[alt]
        if (!altInfo) continue
        if (altInfo.expense_ratio >= info.expense_ratio) continue
        const saving = (info.expense_ratio - altInfo.expense_ratio) / 100 * data.market_value
        if (saving < 10) continue  // ignore trivial savings
        substitutions.push({
          held_ticker: t,
          held_er_pct: info.expense_ratio,
          alternative_ticker: alt,
          alternative_er_pct: altInfo.expense_ratio,
          annual_savings: Math.round(saving),
          market_value: Math.round(data.market_value),
          note: `${t} (${info.expense_ratio}% ER) → ${alt} (${altInfo.expense_ratio}% ER): same ${info.index_tracked ?? 'index'} exposure, $${Math.round(saving)}/yr cheaper.`,
        })
      }
    }
    substitutions.sort((a, b) => b.annual_savings - a.annual_savings)
    const totalAnnualSavings = substitutions.reduce((s, x) => s + x.annual_savings, 0)

    // Unknown tickers (not in DB)
    const unknown = Object.keys(held).filter(t => !FUND_DB[t] && t !== 'TECH' && t !== 'BTC')

    // Per-holding fee summary
    const feeBreakdown = Object.entries(held).map(([t, data]) => ({
      ticker: t,
      market_value: Math.round(data.market_value),
      expense_ratio_pct: data.expense_ratio,
      annual_fee: Math.round(data.market_value * data.expense_ratio / 100),
      allocation_pct: parseFloat((data.market_value / totalPortfolio * 100).toFixed(1)),
      in_db: !!FUND_DB[t],
    })).sort((a, b) => b.annual_fee - a.annual_fee)

    const totalAnnualFees = feeBreakdown.reduce((s, f) => s + f.annual_fee, 0)
    const weightedER = totalPortfolio > 0
      ? parseFloat((feeBreakdown.reduce((s, f) => s + f.expense_ratio_pct * f.market_value, 0) / totalPortfolio).toFixed(3))
      : 0

    return {
      total_analyzed_value: Math.round(totalPortfolio),
      weighted_expense_ratio_pct: weightedER,
      total_annual_fees: totalAnnualFees,
      fee_breakdown: feeBreakdown,
      overlap_groups: overlapGroups,
      substitution_opportunities: substitutions,
      total_annual_savings_available: totalAnnualSavings,
      unknown_tickers: unknown.length ? unknown : [],
      data_note: unknown.length
        ? `${unknown.join(', ')} not in fund database — expense ratio from profile used where available.`
        : null,
      summary: [
        `Weighted portfolio ER: ${weightedER}% ($${totalAnnualFees.toLocaleString()}/yr in fees).`,
        overlapGroups.length ? `${overlapGroups.length} overlap group(s) detected — redundant holdings.` : '',
        substitutions.length ? `${substitutions.length} cheaper substitute(s) available, saving up to $${totalAnnualSavings.toLocaleString()}/yr.` : 'No cheaper substitutes found.',
      ].filter(Boolean).join(' '),
    }
  },
})
