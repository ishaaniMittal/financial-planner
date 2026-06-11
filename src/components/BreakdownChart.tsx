import React from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { CashFlowData } from '@/data/cashflow'
import { formatCurrency } from '@/lib/utils'

interface BreakdownChartProps {
  data: CashFlowData
}

export const BreakdownChart: React.FC<BreakdownChartProps> = ({ data }) => {
  const chartData = data.categories.flatMap((cat) =>
    cat.accounts.map((acc) => ({
      name: acc.name,
      value: acc.value,
      color: acc.color,
      category: cat.name,
    }))
  )

  return (
    <div className="w-full h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis
            dataKey="name"
            angle={-35}
            textAnchor="end"
            height={80}
            fontSize={11}
          />
          <YAxis
            tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
            fontSize={11}
          />
          <Tooltip
            formatter={(value: number) => [formatCurrency(value), 'Amount']}
            labelFormatter={(label) => {
              const item = chartData.find((d) => d.name === label)
              return `${label} (${item?.category})`
            }}
            contentStyle={{
              borderRadius: '8px',
              border: '1px solid hsl(var(--border))',
              backgroundColor: 'hsl(var(--card))',
            }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
