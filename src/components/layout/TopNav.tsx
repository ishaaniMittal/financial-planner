import { Search } from 'lucide-react'

export type Domain =
  | 'overview'
  | 'cashflow'
  | 'tax'
  | 'equity'
  | 'retirement'
  | 'investments'
  | 'risk'

const TABS: { id: Domain; label: string }[] = [
  { id: 'overview',    label: 'Overview' },
  { id: 'cashflow',    label: 'Cash Flow' },
  { id: 'tax',         label: 'Tax' },
  { id: 'equity',      label: 'Equity & Comp' },
  { id: 'retirement',  label: 'Retirement' },
  { id: 'investments', label: 'Investments' },
  { id: 'risk',        label: 'Risk & Estate' },
]

interface TopNavProps {
  active: Domain
  onNavigate: (d: Domain) => void
}

export function TopNav({ active, onNavigate }: TopNavProps) {
  return (
    <header className="fixed top-0 inset-x-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="flex items-center h-14 px-6 gap-8">
        {/* Logo */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 rounded-full bg-gold flex items-center justify-center">
            <div className="w-2.5 h-2.5 rounded-full bg-primary-foreground" />
          </div>
          <span className="font-semibold text-foreground tracking-tight">Meridian</span>
        </div>

        {/* Domain tabs */}
        <nav className="flex items-center gap-1 flex-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => onNavigate(tab.id)}
              className={`
                relative px-3 py-1.5 text-sm font-medium rounded-md transition-colors
                ${active === tab.id
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
                }
              `}
            >
              {tab.label}
              {active === tab.id && (
                <span className="absolute inset-x-3 -bottom-[1px] h-px bg-gold rounded-full" />
              )}
            </button>
          ))}
        </nav>

        {/* Right controls */}
        <div className="flex items-center gap-3 shrink-0">
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted text-muted-foreground text-sm hover:text-foreground transition-colors">
            <Search className="w-3.5 h-3.5" />
            <span>Search or ask…</span>
            <kbd className="ml-1 text-xs bg-background px-1.5 py-0.5 rounded border border-border">⌘K</kbd>
          </button>
          <span className="text-sm text-muted-foreground">FY 2026</span>
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-foreground">
            MC
          </div>
        </div>
      </div>
    </header>
  )
}
