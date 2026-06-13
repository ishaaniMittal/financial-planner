import {
  TrendingUp, BarChart3, Receipt, Briefcase, PiggyBank, Shield
} from 'lucide-react'
import type { Domain } from '@/components/layout/TopNav'
import type { DerivedProfile } from '@/lib/profile-derived'

const DOMAIN_ICONS: Record<string, React.ReactNode> = {
  cashflow:    <TrendingUp className="w-4 h-4" />,
  investments: <BarChart3 className="w-4 h-4" />,
  tax:         <Receipt className="w-4 h-4" />,
  equity:      <Briefcase className="w-4 h-4" />,
  retirement:  <PiggyBank className="w-4 h-4" />,
  risk:        <Shield className="w-4 h-4" />,
}

const DOMAIN_LABELS: Record<string, string> = {
  cashflow:    'Cash flow',
  investments: 'Investments',
  tax:         'Tax',
  equity:      'Equity & Comp',
  retirement:  'Retirement',
  risk:        'Risk & Estate',
}

const DOMAIN_ORDER = ['cashflow', 'investments', 'tax', 'equity', 'retirement', 'risk'] as const

const DOT_COLORS = {
  green: 'bg-status-green',
  amber: 'bg-status-amber',
  red:   'bg-status-red',
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function fmtNetWorth(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  return `$${n.toLocaleString()}`
}

interface OverviewProps {
  derived: DerivedProfile
  onNavigate: (d: Domain) => void
}

export function Overview({ derived, onNavigate }: OverviewProps) {
  const { userName, netWorth, goals, domains } = derived

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
  })

  return (
    <div className="space-y-8">
      {/* Greeting */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">
            {getGreeting()}, {userName}.
          </h1>
          <div className="flex items-center gap-2 mt-2">
            <div className="w-6 h-6 rounded-full bg-gold flex items-center justify-center text-xs font-semibold text-primary-foreground">
              {userName.charAt(0)}
            </div>
            <p className="text-sm text-muted-foreground">
              Your portfolio is up to date.{' '}
              <span className="text-gold font-medium">3 things</span> need your attention.
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground shrink-0 pt-1">{today}</p>
      </div>

      {/* Net Worth */}
      <div className="bg-card rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <span className="label-caps">Net Worth</span>
          <div className="flex gap-1">
            {['1M', '1Y', 'All'].map((r, i) => (
              <button
                key={r}
                className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                  i === 0
                    ? 'bg-secondary text-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-baseline gap-3 mb-4">
          <span className="hero-number">{fmtNetWorth(netWorth)}</span>
        </div>

        {/* Placeholder chart */}
        <div className="h-16 relative overflow-hidden">
          <svg viewBox="0 0 600 80" className="w-full h-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(42 72% 54%)" stopOpacity="0.15" />
                <stop offset="100%" stopColor="hsl(42 72% 54%)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0,68 C60,64 100,60 150,56 C200,52 230,50 280,44 C330,38 370,34 420,28 C470,22 520,18 600,12"
              fill="none"
              stroke="hsl(42 72% 54%)"
              strokeWidth="1.5"
            />
            <path
              d="M0,68 C60,64 100,60 150,56 C200,52 230,50 280,44 C330,38 370,34 420,28 C470,22 520,18 600,12 L600,80 L0,80 Z"
              fill="url(#lineGrad)"
            />
          </svg>
        </div>
      </div>

      {/* Goals */}
      {goals.length > 0 && (
        <div className="space-y-3">
          <span className="label-caps">Your Goals</span>
          <div className="flex flex-col gap-3">
            {goals.map(goal => {
              const pct = Math.min(100, Math.round((goal.current / goal.target) * 100))
              return (
                <div key={goal.label} className="bg-card rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{goal.label}</span>
                    <span className="text-muted-foreground text-xs">
                      ${(goal.current / 1000).toFixed(0)}k of ${(goal.target / 1000).toFixed(0)}k · {goal.targetYear}
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gold rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{pct}% funded</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Domain tiles */}
      <div className="space-y-3">
        <span className="label-caps">Across your money</span>
        <div className="grid grid-cols-3 gap-3">
          {DOMAIN_ORDER.map(id => {
            const m = domains[id]
            if (!m) return null
            return (
              <button
                key={id}
                onClick={() => onNavigate(id as Domain)}
                className="bg-card hover:bg-card-hover rounded-xl p-5 text-left transition-colors group"
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="text-muted-foreground group-hover:text-foreground transition-colors">
                    {DOMAIN_ICONS[id]}
                  </span>
                  <span className={`w-2 h-2 rounded-full mt-0.5 ${DOT_COLORS[m.dot]}`} />
                </div>
                <p className="text-xs text-muted-foreground mb-1">{DOMAIN_LABELS[id]}</p>
                <p className="text-base font-semibold tabular leading-tight">{m.metric}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{m.sub}</p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
