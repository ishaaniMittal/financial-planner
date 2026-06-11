import React from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CashFlowData } from '@/data/cashflow'
import { formatCurrency } from '@/lib/utils'

interface MonthlyTrendsProps {
  data: CashFlowData
}

export const MonthlyTrends: React.FC<MonthlyTrendsProps> = ({ data }) => {
  const chartData = data.monthlyHistory.map((snap) => ({
    ...snap,
    total: snap.taxFree + snap.taxDeferred + snap.taxable + snap.cash,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly Allocation Trends</CardTitle>
        <CardDescription>
          How your monthly contributions distribute across categories over time
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="w-full h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="month" fontSize={12} />
              <YAxis
                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                fontSize={11}
              />
              <Tooltip
                formatter={(value: number, name: string) => {
                  const labels: Record<string, string> = {
                    taxFree: 'Tax-Free',
                    taxDeferred: 'Tax-Deferred',
                    taxable: 'Taxable',
                    cash: 'Cash',
                  }
                  return [formatCurrency(value), labels[name] || name]
                }}
                contentStyle={{
                  borderRadius: '8px',
                  border: '1px solid hsl(var(--border))',
                  backgroundColor: 'hsl(var(--card))',
                }}
              />
              <Legend
                formatter={(value) => {
                  const labels: Record<string, string> = {
                    taxFree: 'Tax-Free',
                    taxDeferred: 'Tax-Deferred',
                    taxable: 'Taxable',
                    cash: 'Cash',
                  }
                  return labels[value] || value
                }}
              />
              <Area
                type="monotone"
                dataKey="taxFree"
                stackId="1"
                stroke="#10b981"
                fill="#10b981"
                fillOpacity={0.6}
              />
              <Area
                type="monotone"
                dataKey="taxDeferred"
                stackId="1"
                stroke="#3b82f6"
                fill="#3b82f6"
                fillOpacity={0.6}
              />
              <Area
                type="monotone"
                dataKey="taxable"
                stackId="1"
                stroke="#f59e0b"
                fill="#f59e0b"
                fillOpacity={0.6}
              />
              <Area
                type="monotone"
                dataKey="cash"
                stackId="1"
                stroke="#8b5cf6"
                fill="#8b5cf6"
                fillOpacity={0.6}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
