import React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CashFlowData } from '@/data/cashflow'
import { formatCurrency } from '@/lib/utils'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'

interface ContributionLimitsProps {
  data: CashFlowData
}

export const ContributionLimits: React.FC<ContributionLimitsProps> = ({ data }) => {
  const accountsWithLimits = data.categories.flatMap((cat) =>
    cat.accounts
      .filter((acc) => acc.annualLimit !== undefined)
      .map((acc) => ({
        ...acc,
        categoryColor: cat.color,
        categoryName: cat.name,
      }))
  )

  const expectedPctByMonth = (data.currentMonth / 12) * 100

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contribution Limits</CardTitle>
        <CardDescription>
          YTD progress against annual IRS limits — you should be ~{expectedPctByMonth.toFixed(0)}% through by now (month {data.currentMonth}/12)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {accountsWithLimits.map((acc) => {
          const pct = (acc.ytdContribution / acc.annualLimit!) * 100
          const onTrack = pct >= expectedPctByMonth - 5
          const maxed = pct >= 100
          const behind = pct < expectedPctByMonth - 10

          return (
            <div key={acc.id} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  {maxed ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : behind ? (
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2" style={{ borderColor: acc.color }} />
                  )}
                  <span className="font-medium">{acc.name}</span>
                  <span className="text-xs text-muted-foreground">({acc.categoryName})</span>
                </div>
                <div className="text-right">
                  <span className="font-mono">
                    {formatCurrency(acc.ytdContribution)} / {formatCurrency(acc.annualLimit!)}
                  </span>
                  {behind && (
                    <span className="ml-2 text-xs text-amber-600 font-medium">Behind pace</span>
                  )}
                  {maxed && (
                    <span className="ml-2 text-xs text-emerald-600 font-medium">Maxed!</span>
                  )}
                </div>
              </div>
              <div className="relative w-full h-3 bg-secondary rounded-full overflow-hidden">
                {/* Expected pace marker */}
                <div
                  className="absolute top-0 h-full w-0.5 bg-foreground/30 z-10"
                  style={{ left: `${Math.min(expectedPctByMonth, 100)}%` }}
                />
                {/* Actual progress */}
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(pct, 100)}%`,
                    backgroundColor: maxed ? '#10b981' : onTrack ? acc.color : '#f59e0b',
                  }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{pct.toFixed(0)}% used</span>
                <span>{formatCurrency(acc.annualLimit! - acc.ytdContribution)} remaining</span>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
