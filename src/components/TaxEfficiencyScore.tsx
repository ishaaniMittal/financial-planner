'use client'

import React, { useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CashFlowData } from '@/data/cashflow'

interface TaxEfficiencyScoreProps {
  data: CashFlowData
}

export const TaxEfficiencyScore: React.FC<TaxEfficiencyScoreProps> = ({ data }) => {
  const { score, maxPossibleScore, breakdown } = useMemo(() => {
    let weightedSum = 0
    let totalValue = 0
    const breakdown: Array<{ name: string; color: string; value: number; weight: number; contribution: number }> = []

    data.categories.forEach((cat) => {
      const catValue = cat.accounts.reduce((s, a) => s + a.value, 0)
      const contribution = catValue * cat.taxEfficiencyWeight
      weightedSum += contribution
      totalValue += catValue
      breakdown.push({
        name: cat.name,
        color: cat.color,
        value: catValue,
        weight: cat.taxEfficiencyWeight,
        contribution,
      })
    })

    const score = totalValue > 0 ? (weightedSum / totalValue) * 100 : 0
    const maxPossibleScore = 100 // if everything were in tax-free

    return { score, maxPossibleScore, breakdown }
  }, [data])

  const getScoreColor = (s: number) => {
    if (s >= 70) return '#10b981'
    if (s >= 50) return '#f59e0b'
    return '#ef4444'
  }

  const getScoreLabel = (s: number) => {
    if (s >= 70) return 'Excellent'
    if (s >= 55) return 'Good'
    if (s >= 40) return 'Fair'
    return 'Needs work'
  }

  const scoreColor = getScoreColor(score)
  const circumference = 2 * Math.PI * 60
  const strokeDashoffset = circumference - (score / maxPossibleScore) * circumference

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tax Efficiency Score</CardTitle>
        <CardDescription>
          Weighted score based on how much money sits in tax-advantaged accounts
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-8">
          {/* Gauge */}
          <div className="relative flex-shrink-0">
            <svg width="140" height="140" className="-rotate-90">
              <circle
                cx="70"
                cy="70"
                r="60"
                fill="none"
                stroke="hsl(var(--secondary))"
                strokeWidth="12"
              />
              <circle
                cx="70"
                cy="70"
                r="60"
                fill="none"
                stroke={scoreColor}
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                className="transition-all duration-700"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold" style={{ color: scoreColor }}>
                {score.toFixed(0)}
              </span>
              <span className="text-xs text-muted-foreground">{getScoreLabel(score)}</span>
            </div>
          </div>

          {/* Breakdown */}
          <div className="flex-1 space-y-3">
            {breakdown.map((item) => (
              <div key={item.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span>{item.name}</span>
                  <span className="text-xs text-muted-foreground">(×{item.weight})</span>
                </div>
                <span className="text-muted-foreground font-mono text-xs">
                  {((item.value / data.totalInput) * 100).toFixed(0)}% of funds
                </span>
              </div>
            ))}
            <div className="pt-2 border-t text-xs text-muted-foreground">
              Score = weighted average of allocation × tax-efficiency multiplier.
              Move funds from low-weight (cash, taxable) to high-weight (tax-free) to improve.
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
