import {
  TrendingUp, BarChart3, Receipt, Briefcase, PiggyBank, LineChart, Shield
} from 'lucide-react'
import type { Domain } from '@/components/layout/TopNav'

interface DomainTile {
  id: Domain
  label: string
  icon: React.ReactNode
  metric: string
  sub: string
  dot: 'green' | 'amber' | 'red'
}

const TILES: DomainTile[] = [
  {
    id: 'cashflow',
    label: 'Cash flow',
    icon: <TrendingUp className="w-4 h-4" />,
    metric: '+$3,200/mo',
    sub: 'positive buffer',
    dot: 'green',
  },
  {
    id: 'investments',
    label: 'Investments',
    icon: <BarChart3 className="w-4 h-4" />,
    metric: '70/30',
    sub: 'on target',
    dot: 'green',
  },
  {
    id: 'tax',
    label: 'Tax',
    icon: <Receipt className="w-4 h-4" />,
    metric: '$8,400',
    sub: 'to recover',
    dot: 'amber',
  },
  {
    id: 'equity',
    label: 'Equity & Comp',
    icon: <Briefcase className="w-4 h-4" />,
    metric: '32%',
    sub: 'in employer stock',
    dot: 'amber',
  },
  {
    id: 'retirement',
    label: 'Retirement',
    icon: <PiggyBank className="w-4 h-4" />,
    metric: 'On track',
    sub: 'retire at 55',
    dot: 'green',
  },
  {
    id: 'risk',
    label: 'Risk & Estate',
    icon: <Shield className="w-4 h-4" />,
    metric: 'Will',
    sub: '2 yrs old',
    dot: 'red',
  },
]

interface GoalBar {
  label: string
  current: number
  target: number
  targetYear: number
}

const GOALS: GoalBar[] = [
  { label: 'Retire at 55', current: 310000, target: 800000, targetYear: 2041 },
  { label: 'College fund', current: 28000, target: 120000, targetYear: 2038 },
]

interface OverviewProps {
  onNavigate: (d: Domain) => void
  userName?: string
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const DOT_COLORS = {
  green: 'bg-status-green',
  amber: 'bg-status-amber',
  red:   'bg-status-red',
}

export function Overview({ onNavigate, userName = 'Maya' }: OverviewProps) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })

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
              Since yesterday you're up{' '}
              <span className="text-foreground font-medium">$12.4k</span>.
              {' '}I flagged{' '}
              <span className="text-gold font-medium">3 things</span> worth a look.
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground shrink-0">{today}</p>
      </div>

      {/* Net Worth */}
      <div className="bg-card rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <span className="label-caps">Net Worth</span>
          <div className="flex gap-1">
            {['1M', '1Y', 'All'].map(r => (
              <button
                key={r}
                className="px-3 py-1 text-xs rounded-lg bg-muted text-muted-foreground hover:text-foreground transition-colors first:bg-secondary first:text-foreground"
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-baseline gap-3 mb-6">
          <span className="hero-number">$1,642,800</span>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-status-green/15 text-status-green text-sm font-medium">
            <TrendingUp className="w-3.5 h-3.5" />
            +$12,400 · +0.8% · past 30 days
          </div>
        </div>

        {/* Placeholder chart */}
        <div className="h-16 relative overflow-hidden">
          <svg viewBox="0 0 600 100" className="w-full h-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(42 72% 54%)" stopOpacity="0.15" />
                <stop offset="100%" stopColor="hsl(42 72% 54%)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0,85 C60,80 100,75 150,70 C200,65 230,62 280,55 C330,48 370,42 420,35 C470,28 520,22 600,15"
              fill="none"
              stroke="hsl(42 72% 54%)"
              strokeWidth="1.5"
            />
            <path
              d="M0,85 C60,80 100,75 150,70 C200,65 230,62 280,55 C330,48 370,42 420,35 C470,28 520,22 600,15 L600,100 L0,100 Z"
              fill="url(#lineGrad)"
            />
          </svg>
        </div>
      </div>

      {/* Goals */}
      {GOALS.length > 0 && (
        <div className="space-y-3">
          <span className="label-caps">Your Goals</span>
          <div className="flex flex-col gap-3">
            {GOALS.map(goal => {
              const pct = Math.round((goal.current / goal.target) * 100)
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
          {TILES.map(tile => (
            <button
              key={tile.id}
              onClick={() => onNavigate(tile.id)}
              className="bg-card hover:bg-card-hover rounded-xl p-5 text-left transition-colors group"
            >
              <div className="flex items-start justify-between mb-3">
                <span className="text-muted-foreground group-hover:text-foreground transition-colors">
                  {tile.icon}
                </span>
                <span className={`w-2 h-2 rounded-full mt-0.5 ${DOT_COLORS[tile.dot]}`} />
              </div>
              <p className="text-xs text-muted-foreground mb-1">{tile.label}</p>
              <p className="text-base font-semibold tabular leading-tight">{tile.metric}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{tile.sub}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
