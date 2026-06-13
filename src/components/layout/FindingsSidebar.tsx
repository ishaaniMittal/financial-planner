import { ArrowRight } from 'lucide-react'

interface Finding {
  id: string
  title: string
  description: string
  primaryAction: string
  secondaryAction: string
  dot: 'green' | 'amber' | 'red'
}

// Placeholder findings — will be replaced by agent output in Phase 2
const PLACEHOLDER_FINDINGS: Finding[] = [
  {
    id: '1',
    dot: 'amber',
    title: 'Harvest losses before year-end',
    description: '~$9,200 of harvestable losses are available now. Acting saves roughly $2,300 this year.',
    primaryAction: 'Review',
    secondaryAction: 'Snooze',
  },
  {
    id: '2',
    dot: 'amber',
    title: '$48k of idle cash',
    description: 'Sitting in checking at 0.1%. A money-market at 4.6% would earn about $2,150/yr.',
    primaryAction: 'Move it',
    secondaryAction: 'Why?',
  },
  {
    id: '3',
    dot: 'red',
    title: 'Estate docs are dated',
    description: 'Your will predates your second child. Worth a refresh — I can outline what changed.',
    primaryAction: 'Plan it',
    secondaryAction: 'Later',
  },
]

interface SavedReport {
  id: string
  title: string
  subtitle: string
  icon: 'doc' | 'chart'
}

const PLACEHOLDER_REPORTS: SavedReport[] = [
  { id: '1', title: '2026 Tax Strategy', subtitle: 'updated 2 days ago', icon: 'doc' },
  { id: '2', title: 'Retirement readiness', subtitle: 'last week', icon: 'chart' },
]

export function FindingsSidebar() {
  return (
    <aside className="flex flex-col gap-6 p-6">
      {/* Needs Your Attention */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <span className="label-caps">Needs your attention</span>
          <span className="text-xs font-semibold bg-muted text-foreground px-2 py-0.5 rounded-full">
            {PLACEHOLDER_FINDINGS.length}
          </span>
        </div>
        <div className="flex flex-col gap-3">
          {PLACEHOLDER_FINDINGS.map(f => (
            <div key={f.id} className="bg-card rounded-xl p-4 space-y-2 border border-border/50 hover:border-border transition-colors">
              <div className="flex items-start gap-2">
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 dot-${f.dot}`} />
                <p className="text-sm font-semibold leading-snug">{f.title}</p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed pl-3.5">
                {f.description}
              </p>
              <div className="flex items-center gap-2 pl-3.5 pt-1">
                <button className="text-xs px-3 py-1 rounded-md border border-gold text-gold hover:bg-gold hover:text-primary-foreground transition-colors">
                  {f.primaryAction}
                </button>
                <button className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                  {f.secondaryAction}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Saved Reports */}
      <section>
        <div className="mb-3">
          <span className="label-caps">Saved Reports</span>
        </div>
        <div className="flex flex-col gap-2">
          {PLACEHOLDER_REPORTS.map(r => (
            <button
              key={r.id}
              className="flex items-center gap-3 p-3 rounded-xl bg-card hover:bg-card-hover transition-colors text-left group"
            >
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
                {r.icon === 'doc' ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{r.title}</p>
                <p className="text-xs text-muted-foreground">{r.subtitle}</p>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </button>
          ))}
        </div>
      </section>
    </aside>
  )
}
