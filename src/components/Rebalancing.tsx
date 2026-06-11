import React, { useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CashFlowData } from '@/data/cashflow'
import { formatCurrency } from '@/lib/utils'
import { ArrowRight, Zap } from 'lucide-react'

interface RebalancingProps {
  data: CashFlowData
}

interface Recommendation {
  id: string
  priority: 'high' | 'medium' | 'low'
  action: string
  from: string
  to: string
  amount: number
  reason: string
}

export const Rebalancing: React.FC<RebalancingProps> = ({ data }) => {
  const recommendations = useMemo(() => {
    const recs: Recommendation[] = []

    // Check for idle cash
    const cashCategory = data.categories.find((c) => c.id === 'cash')
    const totalCash = cashCategory?.accounts.reduce((s, a) => s + a.value, 0) ?? 0
    const excessCash = totalCash - data.targetEmergencyFund

    // Find accounts with remaining limit capacity (prioritize by tax efficiency weight)
    const accountsWithCapacity = data.categories
      .filter((cat) => cat.id !== 'cash')
      .sort((a, b) => b.taxEfficiencyWeight - a.taxEfficiencyWeight)
      .flatMap((cat) =>
        cat.accounts
          .filter((acc) => acc.annualLimit && acc.ytdContribution < acc.annualLimit)
          .map((acc) => ({
            ...acc,
            remaining: acc.annualLimit! - acc.ytdContribution,
            categoryName: cat.name,
            weight: cat.taxEfficiencyWeight,
          }))
      )

    // Recommendation: Move excess cash to unfilled tax-advantaged accounts
    let remainingExcess = excessCash
    if (remainingExcess > 0) {
      for (const acc of accountsWithCapacity) {
        if (remainingExcess <= 0) break
        const moveAmount = Math.min(remainingExcess, acc.remaining)
        if (moveAmount >= 500) {
          recs.push({
            id: `cash-to-${acc.id}`,
            priority: acc.weight >= 0.75 ? 'high' : 'medium',
            action: 'Move idle cash',
            from: 'Cash Reserves',
            to: acc.name,
            amount: moveAmount,
            reason: `${acc.name} has ${formatCurrency(acc.remaining)} of annual limit unused`,
          })
          remainingExcess -= moveAmount
        }
      }
    }

    // Check for behind-pace accounts
    const expectedPct = data.currentMonth / 12
    for (const cat of data.categories) {
      for (const acc of cat.accounts) {
        if (acc.annualLimit) {
          const expectedContribution = acc.annualLimit * expectedPct
          const deficit = expectedContribution - acc.ytdContribution
          if (deficit > 1000) {
            recs.push({
              id: `pace-${acc.id}`,
              priority: cat.taxEfficiencyWeight >= 0.75 ? 'high' : 'low',
              action: 'Increase contribution pace',
              from: 'Monthly income',
              to: acc.name,
              amount: Math.round(deficit / (12 - data.currentMonth)),
              reason: `Behind pace by ${formatCurrency(deficit)} — increase monthly by this amount to catch up`,
            })
          }
        }
      }
    }

    return recs.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 }
      return priorityOrder[a.priority] - priorityOrder[b.priority]
    })
  }, [data])

  const priorityStyles = {
    high: 'border-l-red-500 bg-red-50/30',
    medium: 'border-l-amber-500 bg-amber-50/30',
    low: 'border-l-blue-500 bg-blue-50/30',
  }

  const priorityLabels = {
    high: { text: 'High', color: 'text-red-600 bg-red-100' },
    medium: { text: 'Medium', color: 'text-amber-600 bg-amber-100' },
    low: { text: 'Low', color: 'text-blue-600 bg-blue-100' },
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-amber-500" />
          Rebalancing Recommendations
        </CardTitle>
        <CardDescription>
          Specific actions to improve dollar efficiency based on your targets and limits
        </CardDescription>
      </CardHeader>
      <CardContent>
        {recommendations.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            All accounts are on track. No rebalancing needed this month.
          </div>
        ) : (
          <div className="space-y-3">
            {recommendations.map((rec) => (
              <div
                key={rec.id}
                className={`border-l-4 rounded-r-lg p-3 ${priorityStyles[rec.priority]}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${priorityLabels[rec.priority].color}`}>
                        {priorityLabels[rec.priority].text}
                      </span>
                      <span className="text-sm font-medium">{rec.action}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <span>{rec.from}</span>
                      <ArrowRight className="h-3 w-3" />
                      <span className="font-medium text-foreground">{rec.to}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{rec.reason}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-lg font-bold font-mono">{formatCurrency(rec.amount)}</div>
                    <div className="text-xs text-muted-foreground">
                      {rec.action.includes('pace') ? '/mo' : 'one-time'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
