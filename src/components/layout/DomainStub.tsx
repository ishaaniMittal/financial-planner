import type { Domain } from '@/components/layout/TopNav'

const DOMAIN_META: Record<Domain, { label: string; goal: string }> = {
  overview:    { label: 'Overview',         goal: '' },
  cashflow:    { label: 'Cash Flow',        goal: 'Income covers spending with buffer. Accounts structured with clear purpose.' },
  tax:         { label: 'Tax',              goal: 'Minimize current-year liability and future tax drag. Assets in the right tax buckets.' },
  equity:      { label: 'Equity & Comp',    goal: 'RSU/option/ESPP strategy defined. Vesting events handled tax-efficiently. Concentration below threshold.' },
  retirement:  { label: 'Retirement & Benefits', goal: 'Tax-advantaged accounts maxed. Backdoor Roth executed if eligible. Benefits elected optimally.' },
  investments: { label: 'Investments',      goal: 'Portfolio allocated to target. Low-cost funds. Tax-efficient placement. Rebalanced when drifted.' },
  risk:        { label: 'Risk & Estate',    goal: 'Insurance adequate. Estate documents current. Beneficiaries correct.' },
}

interface DomainStubProps {
  domain: Domain
}

export function DomainStub({ domain }: DomainStubProps) {
  const meta = DOMAIN_META[domain]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{meta.label}</h2>
        {meta.goal && (
          <p className="text-sm text-muted-foreground mt-2 max-w-xl">{meta.goal}</p>
        )}
      </div>

      {/* Findings placeholder */}
      <div className="bg-card rounded-2xl p-8 flex flex-col items-center justify-center text-center gap-3 border border-dashed border-border min-h-[200px]">
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
          <span className="text-muted-foreground text-lg">✦</span>
        </div>
        <p className="text-sm font-medium">Findings coming in Phase 2</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          The agent will analyze this domain and surface specific, ranked findings with estimated impact.
        </p>
      </div>
    </div>
  )
}
