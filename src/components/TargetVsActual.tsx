import React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CashFlowData } from '@/data/cashflow'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'

interface TargetVsActualProps {
  data: CashFlowData
}

export const TargetVsActual: React.FC<TargetVsActualProps> = ({ data }) => {
  const allAccounts = data.categories.flatMap((cat) =>
    cat.accounts.map((acc) => {
      const actualPct = (acc.value / data.totalInput) * 100
      const drift = actualPct - acc.targetAllocationPct
      return {
        ...acc,
        categoryName: cat.name,
        categoryColor: cat.color,
        actualPct,
        drift,
      }
    })
  )

  const getDriftStatus = (drift: number) => {
    if (drift > 2)
      return { label: 'Over', icon: <ArrowUp className="h-3.5 w-3.5" />, color: 'text-amber-600', bg: 'bg-amber-50' }
    if (drift < -2)
      return { label: 'Under', icon: <ArrowDown className="h-3.5 w-3.5" />, color: 'text-red-600', bg: 'bg-red-50' }
    return { label: 'On track', icon: <Minus className="h-3.5 w-3.5" />, color: 'text-emerald-600', bg: 'bg-emerald-50' }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Target vs. Actual</CardTitle>
        <CardDescription>
          Allocation drift from your plan — flags accounts more than 2% off target
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {allAccounts.map((acc) => {
            const status = getDriftStatus(acc.drift)
            return (
              <div key={acc.id} className="flex items-center gap-3">
                {/* Account name */}
                <div className="w-40 flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: acc.color }} />
                  <span className="text-sm font-medium truncate">{acc.name}</span>
                </div>

                {/* Bar comparison */}
                <div className="flex-1 relative h-6">
                  {/* Target marker */}
                  <div
                    className="absolute top-0 h-full w-0.5 bg-foreground/40 z-10"
                    style={{ left: `${Math.min(acc.targetAllocationPct * 3, 100)}%` }}
                  />
                  {/* Actual bar */}
                  <div className="h-full bg-secondary rounded overflow-hidden">
                    <div
                      className="h-full rounded transition-all"
                      style={{
                        width: `${Math.min(acc.actualPct * 3, 100)}%`,
                        backgroundColor: acc.color,
                        opacity: 0.7,
                      }}
                    />
                  </div>
                </div>

                {/* Numbers */}
                <div className="w-24 text-right text-xs">
                  <div className="font-mono">{acc.actualPct.toFixed(1)}%</div>
                  <div className="text-muted-foreground">target {acc.targetAllocationPct.toFixed(1)}%</div>
                </div>

                {/* Status badge */}
                <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${status.color} ${status.bg}`}>
                  {status.icon}
                  <span>{status.label}</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Summary */}
        <div className="mt-4 pt-4 border-t text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {allAccounts.filter((a) => Math.abs(a.drift) <= 2).length}/{allAccounts.length}
          </span>{' '}
          accounts on track •{' '}
          <span className="font-medium text-amber-600">
            {allAccounts.filter((a) => a.drift > 2).length}
          </span>{' '}
          over-allocated •{' '}
          <span className="font-medium text-red-600">
            {allAccounts.filter((a) => a.drift < -2).length}
          </span>{' '}
          under-allocated
        </div>
      </CardContent>
    </Card>
  )
}
