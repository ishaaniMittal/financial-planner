import type { FinancialProfile } from '@/lib/profile'

export interface DerivedGoal {
  label: string
  current: number
  target: number
  targetYear: number
}

export type StatusDot = 'green' | 'amber' | 'red'

export interface DomainMetric {
  metric: string
  sub: string
  dot: StatusDot
}

export interface DerivedProfile {
  userName: string
  netWorth: number
  totalAssets: number
  totalLiabilities: number
  goals: DerivedGoal[]
  domains: Record<string, DomainMetric>
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${Math.round(n)}`
}

export function deriveProfile(p: FinancialProfile): DerivedProfile {
  const primary = p.household?.find(m => m.is_primary)
  const userName = primary?.name ?? 'there'

  // Net worth
  const totalAccounts = p.accounts.reduce((s, a) => s + a.balance, 0)
  const propertyValue = (p.liabilities ?? [])
    .filter(l => l.type === 'mortgage')
    .reduce((s, l) => s + (l.property_value ?? 0), 0)
  const totalAssets = totalAccounts + propertyValue
  const totalLiabilities = (p.liabilities ?? []).reduce((s, l) => s + l.balance, 0)
  const netWorth = totalAssets - totalLiabilities

  // Goals
  const goals: DerivedGoal[] = (p.goals ?? []).map(g => ({
    label: g.name,
    current: g.current_progress,
    target: g.target_amount,
    targetYear: new Date(g.target_date).getFullYear(),
  }))

  // Cash flow
  const monthlyIncome = (p.income ?? []).reduce((s, i) => s + i.annual_amount, 0) / 12
  const monthlySpending = (p.spending ?? []).reduce((s, sp) => s + sp.monthly_amount, 0)
  const monthlyCashFlow = monthlyIncome - monthlySpending

  const cashBalance = p.accounts
    .filter(a => a.tax_treatment === 'cash')
    .reduce((s, a) => s + a.balance, 0)
  const monthsOfCash = monthlySpending > 0 ? cashBalance / monthlySpending : 0

  // Investment allocation (equity vs bonds/other)
  const investmentAccounts = p.accounts.filter(a => a.tax_treatment !== 'cash')
  const totalInvested = investmentAccounts.reduce((s, a) => s + a.balance, 0)
  const equityValue = investmentAccounts.reduce((s, a) =>
    s + a.holdings
      .filter(h => h.asset_class.includes('equity') || h.asset_class === 'crypto')
      .reduce((hs, h) => hs + h.shares * h.current_price, 0)
  , 0)
  const equityPct = totalInvested > 0 ? Math.round((equityValue / totalInvested) * 100) : 0
  const bondPct = 100 - equityPct

  // Employer stock concentration (ESPP + unvested RSUs as % of net worth)
  const esppBalance = p.accounts.find(a => a.id === 'espp')?.balance ?? 0
  const employerStockPct = netWorth > 0 ? Math.round((esppBalance / netWorth) * 100) : 0

  // Tax opportunity (simple proxy: use estimated AGI × combined rates)
  const agi = p.tax?.estimated_agi ?? 0
  const taxOpportunity = Math.round(agi * 0.03) // rough 3% optimization opportunity

  // Retirement progress
  const retirementGoal = goals.find(g => g.label.toLowerCase().includes('retire'))
  const retirementPct = retirementGoal
    ? Math.round((retirementGoal.current / retirementGoal.target) * 100)
    : 0

  const domains: Record<string, DomainMetric> = {
    cashflow: {
      metric: `${monthlyCashFlow >= 0 ? '+' : ''}${fmt(monthlyCashFlow)}/mo`,
      sub: monthsOfCash >= 3 ? 'positive buffer' : `${monthsOfCash.toFixed(1)} mo cash`,
      dot: monthsOfCash >= 3 && monthlyCashFlow > 0 ? 'green' : monthsOfCash >= 2 ? 'amber' : 'red',
    },
    investments: {
      metric: `${equityPct}/${bondPct}`,
      sub: Math.abs(equityPct - 70) <= 10 ? 'on target' : 'needs rebalancing',
      dot: Math.abs(equityPct - 70) <= 10 ? 'green' : 'amber',
    },
    tax: {
      metric: fmt(taxOpportunity),
      sub: 'to optimize',
      dot: 'amber',
    },
    equity: {
      metric: `${employerStockPct}%`,
      sub: 'in employer stock',
      dot: employerStockPct > 20 ? 'red' : employerStockPct > 10 ? 'amber' : 'green',
    },
    retirement: {
      metric: retirementPct >= 50 ? 'On track' : `${retirementPct}% funded`,
      sub: primary?.retirement_age ? `retire at ${primary.retirement_age}` : 'long-term goal',
      dot: retirementPct >= 60 ? 'green' : retirementPct >= 30 ? 'amber' : 'red',
    },
    risk: {
      metric: 'Review',
      sub: 'docs not on file',
      dot: 'amber',
    },
  }

  return { userName, netWorth, totalAssets, totalLiabilities, goals, domains }
}
