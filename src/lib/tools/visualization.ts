import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { loadProfile, type FinancialProfile, type AccountTaxTreatment } from '../profile'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

const CATEGORY_COLORS: Record<string, string> = {
  'Tax-Free': '#10b981',
  'Tax-Deferred': '#3b82f6',
  'Taxable': '#f59e0b',
  'Cash': '#8b5cf6',
}

const TREATMENT_LABEL: Record<AccountTaxTreatment, string> = {
  tax_free: 'Tax-Free',
  tax_deferred: 'Tax-Deferred',
  taxable: 'Taxable',
  cash: 'Cash',
}

export function buildSpec(chartType: string, title: string, profile: FinancialProfile): Record<string, unknown> {
  switch (chartType) {
    case 'allocation_bar': return allocationBar(title, profile)
    case 'contribution_progress': return contributionProgress(title, profile)
    case 'monthly_trend': return monthlyTrend(title, profile)
    case 'asset_location_heatmap': return assetLocationHeatmap(title, profile)
    case 'tax_efficiency_donut': return taxEfficiencyDonut(title, profile)
    case 'account_breakdown_treemap': return accountBreakdownTreemap(title, profile)
    case 'drift_bar': return driftBar(title, profile)
    case 'holdings_pie': return holdingsPie(title, profile)
    case 'cash_flow_waterfall': return cashFlowWaterfall(title, profile)
    default: return allocationBar(title, profile)
  }
}

function allocationBar(title: string, profile: FinancialProfile) {
  const data = profile.accounts.map(a => ({
    account: a.name,
    category: TREATMENT_LABEL[a.tax_treatment],
    value: a.balance,
  }))
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json', title,
    width: 500, height: 300,
    data: { values: data },
    mark: { type: 'bar', cornerRadiusEnd: 4 },
    encoding: {
      y: { field: 'account', type: 'nominal', sort: '-x', title: null },
      x: { field: 'value', type: 'quantitative', title: 'Balance ($)' },
      color: { field: 'category', type: 'nominal', scale: { domain: Object.keys(CATEGORY_COLORS), range: Object.values(CATEGORY_COLORS) }, title: 'Account Type' },
      tooltip: [{ field: 'account', type: 'nominal' }, { field: 'category', type: 'nominal' }, { field: 'value', type: 'quantitative', format: '$,.0f' }],
    },
  }
}

function contributionProgress(title: string, profile: FinancialProfile) {
  const data: { account: string; measure: string; value: number }[] = []
  for (const a of profile.accounts) {
    if (a.annual_contribution_limit === null) continue
    data.push({ account: a.name, measure: 'YTD Contributed', value: a.ytd_contribution })
    data.push({ account: a.name, measure: 'Annual Limit', value: a.annual_contribution_limit })
  }
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json', title,
    width: 500, height: 250,
    data: { values: data },
    mark: { type: 'bar', cornerRadiusEnd: 3 },
    encoding: {
      y: { field: 'account', type: 'nominal', title: null },
      x: { field: 'value', type: 'quantitative', title: 'Amount ($)' },
      color: { field: 'measure', type: 'nominal', scale: { domain: ['YTD Contributed', 'Annual Limit'], range: ['#10b981', '#e2e8f0'] } },
      xOffset: { field: 'measure' },
      tooltip: [{ field: 'account', type: 'nominal' }, { field: 'measure', type: 'nominal' }, { field: 'value', type: 'quantitative', format: '$,.0f' }],
    },
  }
}

function monthlyTrend(title: string, profile: FinancialProfile) {
  const data: { month: string; category: string; value: number }[] = []
  for (const snap of profile.monthly_history) {
    data.push({ month: snap.month, category: 'Tax-Free', value: snap.tax_free })
    data.push({ month: snap.month, category: 'Tax-Deferred', value: snap.tax_deferred })
    data.push({ month: snap.month, category: 'Taxable', value: snap.taxable })
    data.push({ month: snap.month, category: 'Cash', value: snap.cash })
  }
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json', title,
    width: 500, height: 280,
    data: { values: data },
    mark: { type: 'area', interpolate: 'monotone' },
    encoding: {
      x: { field: 'month', type: 'ordinal', title: 'Month' },
      y: { field: 'value', type: 'quantitative', stack: 'zero', title: 'Monthly Contribution ($)' },
      color: { field: 'category', type: 'nominal', scale: { domain: Object.keys(CATEGORY_COLORS), range: Object.values(CATEGORY_COLORS) } },
      tooltip: [{ field: 'month' }, { field: 'category' }, { field: 'value', format: '$,.0f' }],
    },
  }
}

function assetLocationHeatmap(title: string, profile: FinancialProfile) {
  const agg: Record<string, number> = {}
  for (const account of profile.accounts) {
    if (account.tax_treatment === 'cash') continue
    const accType = TREATMENT_LABEL[account.tax_treatment]
    for (const h of account.holdings) {
      const val = h.shares * (h.cost_basis_per_share > 0 ? h.cost_basis_per_share : 100)
      const key = `${accType}|${h.asset_class.replace(/_/g, ' ')}`
      agg[key] = (agg[key] ?? 0) + val
    }
  }
  const data = Object.entries(agg).map(([k, v]) => {
    const [account_type, asset_class] = k.split('|')
    return { account_type, asset_class, value: v }
  })
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json', title,
    width: 400, height: 250,
    data: { values: data },
    mark: { type: 'rect', cornerRadius: 4 },
    encoding: {
      x: { field: 'account_type', type: 'nominal', title: 'Account Type' },
      y: { field: 'asset_class', type: 'nominal', title: 'Asset Class' },
      color: { field: 'value', type: 'quantitative', title: 'Value ($)', scale: { scheme: 'blues' } },
      tooltip: [{ field: 'account_type' }, { field: 'asset_class' }, { field: 'value', format: '$,.0f' }],
    },
  }
}

function taxEfficiencyDonut(title: string, profile: FinancialProfile) {
  const totals: Record<string, number> = {}
  for (const a of profile.accounts) {
    const cat = TREATMENT_LABEL[a.tax_treatment]
    totals[cat] = (totals[cat] ?? 0) + a.balance
  }
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json', title,
    width: 300, height: 300,
    data: { values: Object.entries(totals).map(([category, value]) => ({ category, value })) },
    mark: { type: 'arc', innerRadius: 70, cornerRadius: 4 },
    encoding: {
      theta: { field: 'value', type: 'quantitative', stack: true },
      color: { field: 'category', type: 'nominal', scale: { domain: Object.keys(CATEGORY_COLORS), range: Object.values(CATEGORY_COLORS) } },
      tooltip: [{ field: 'category' }, { field: 'value', format: '$,.0f' }],
    },
  }
}

function accountBreakdownTreemap(title: string, profile: FinancialProfile) {
  const data = profile.accounts.map(a => ({
    category: TREATMENT_LABEL[a.tax_treatment],
    account: a.name,
    value: a.balance,
  }))
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json', title,
    width: 500, height: 300,
    data: { values: data },
    mark: { type: 'circle', opacity: 0.8 },
    encoding: {
      x: { field: 'category', type: 'nominal', title: null },
      y: { field: 'value', type: 'quantitative', title: 'Balance ($)' },
      size: { field: 'value', type: 'quantitative', legend: null },
      color: { field: 'category', type: 'nominal', scale: { domain: Object.keys(CATEGORY_COLORS), range: Object.values(CATEGORY_COLORS) } },
      tooltip: [{ field: 'account' }, { field: 'category' }, { field: 'value', format: '$,.0f' }],
    },
  }
}

function driftBar(title: string, profile: FinancialProfile) {
  const total = profile.accounts.reduce((s, a) => s + a.balance, 0)
  const data = profile.accounts.map(a => ({
    account: a.name,
    drift: parseFloat(((a.balance / total * 100) - a.target_allocation_pct).toFixed(2)),
    status: (a.balance / total * 100) > a.target_allocation_pct ? 'Over' : 'Under',
  }))
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json', title,
    width: 500, height: 280,
    data: { values: data },
    mark: { type: 'bar', cornerRadiusEnd: 3 },
    encoding: {
      y: { field: 'account', type: 'nominal', sort: { field: 'drift', order: 'descending' }, title: null },
      x: { field: 'drift', type: 'quantitative', title: 'Drift (percentage points)' },
      color: { field: 'status', type: 'nominal', scale: { domain: ['Over', 'Under'], range: ['#f59e0b', '#3b82f6'] } },
      tooltip: [{ field: 'account' }, { field: 'drift', format: '+.1f' }],
    },
  }
}

function holdingsPie(title: string, profile: FinancialProfile) {
  const totals: Record<string, number> = {}
  for (const account of profile.accounts) {
    for (const h of account.holdings) {
      const val = h.shares * (h.cost_basis_per_share > 0 ? h.cost_basis_per_share : 100)
      const label = h.asset_class.replace(/_/g, ' ')
      totals[label] = (totals[label] ?? 0) + val
    }
  }
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json', title,
    width: 320, height: 320,
    data: { values: Object.entries(totals).map(([asset_class, value]) => ({ asset_class, value })) },
    mark: { type: 'arc', cornerRadius: 3 },
    encoding: {
      theta: { field: 'value', type: 'quantitative', stack: true },
      color: { field: 'asset_class', type: 'nominal', scale: { scheme: 'tableau10' }, title: 'Asset Class' },
      tooltip: [{ field: 'asset_class' }, { field: 'value', format: '$,.0f' }],
    },
  }
}

function cashFlowWaterfall(title: string, profile: FinancialProfile) {
  const totals: Record<string, number> = {}
  for (const a of profile.accounts) {
    const cat = TREATMENT_LABEL[a.tax_treatment]
    const annualized = a.ytd_contribution * (12 / Math.max(profile.current_month, 1))
    totals[cat] = (totals[cat] ?? 0) + annualized
  }
  let running = 0
  const order = ['Tax-Free', 'Tax-Deferred', 'Taxable', 'Cash']
  const data = order.map(cat => {
    const val = totals[cat] ?? 0
    const item = { category: cat, start: running, end: running + val, value: val }
    running += val
    return item
  })
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json', title,
    width: 450, height: 280,
    data: { values: data },
    mark: { type: 'bar', cornerRadius: 4 },
    encoding: {
      x: { field: 'category', type: 'nominal', title: null, sort: order },
      y: { field: 'start', type: 'quantitative', title: 'Annual Allocation ($)' },
      y2: { field: 'end' },
      color: { field: 'category', type: 'nominal', scale: { domain: order, range: Object.values(CATEGORY_COLORS) }, legend: null },
      tooltip: [{ field: 'category' }, { field: 'value', format: '$,.0f' }],
    },
  }
}

const REPORTS_PATH = path.join(process.cwd(), 'reports.json')

function loadReports(): Record<string, unknown>[] {
  if (!fs.existsSync(REPORTS_PATH)) return []
  return JSON.parse(fs.readFileSync(REPORTS_PATH, 'utf-8'))
}

function saveReports(reports: Record<string, unknown>[]) {
  fs.writeFileSync(REPORTS_PATH, JSON.stringify(reports, null, 2))
}

export const visualize = tool({
  description: `Create a visualization to display financial data inline in the chat.
Choose the most effective chart type:
- allocation_bar: account balances by category
- contribution_progress: YTD vs annual limits
- monthly_trend: monthly allocation trends
- asset_location_heatmap: asset classes vs account types
- tax_efficiency_donut: allocation by tax treatment
- account_breakdown_treemap: all accounts by category
- drift_bar: target vs actual allocation drift
- holdings_pie: portfolio by asset class
- cash_flow_waterfall: annualized income flow`,
  inputSchema: zodSchema(z.object({
    chart_type: z.string().describe('Chart type to create.'),
    title: z.string().describe('Descriptive title for the chart.'),
    description: z.string().describe('Brief explanation of what the chart shows.'),
  })),
  execute: async ({ chart_type, title, description }) => {
    const profile = loadProfile()
    const spec = buildSpec(chart_type, title, profile)
    return `${description}\n\n\`\`\`vega-lite\n${JSON.stringify(spec, null, 2)}\n\`\`\``
  },
})

export const saveToReport = tool({
  description: "Save a visualization to the user's persistent report dashboard. Use when user says 'save', 'pin', or 'add to dashboard'.",
  inputSchema: zodSchema(z.object({
    chart_type: z.string(),
    title: z.string(),
    description: z.string().optional(),
  })),
  execute: async ({ chart_type, title, description = '' }) => {
    const reports = loadReports()
    const exists = reports.find((r: Record<string, unknown>) => r.chart_type === chart_type && r.title === title)
    if (exists) return `Already saved: '${title}' is already in your report dashboard.`

    const item = {
      id: uuidv4().slice(0, 8),
      chart_type, title, description,
      created_at: new Date().toISOString(),
      position: reports.length,
    }
    reports.push(item)
    saveReports(reports)
    return `Saved to report dashboard: '${title}'. View it in the Reports tab.`
  },
})
