'use client'

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CashFlowData } from '@/data/cashflow'
import { formatCurrency } from '@/lib/utils'
import { DollarSign, TrendingUp, PiggyBank, Wallet } from 'lucide-react'

interface SummaryCardsProps {
  data: CashFlowData
}

const iconMap: Record<string, React.ReactNode> = {
  'tax-free': <TrendingUp className="h-4 w-4 text-emerald-500" />,
  'tax-deferred': <PiggyBank className="h-4 w-4 text-blue-500" />,
  'taxable': <DollarSign className="h-4 w-4 text-amber-500" />,
  'cash': <Wallet className="h-4 w-4 text-violet-500" />,
}

export const SummaryCards: React.FC<SummaryCardsProps> = ({ data }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {data.categories.map((category) => {
        const total = category.accounts.reduce((s, a) => s + a.value, 0)
        const percentage = ((total / data.totalInput) * 100).toFixed(1)
        return (
          <Card key={category.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{category.name}</CardTitle>
              {iconMap[category.id]}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(total)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {percentage}% of total input
              </p>
              <div className="mt-3 w-full bg-secondary rounded-full h-2">
                <div
                  className="h-2 rounded-full transition-all"
                  style={{
                    width: `${percentage}%`,
                    backgroundColor: category.color,
                  }}
                />
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
