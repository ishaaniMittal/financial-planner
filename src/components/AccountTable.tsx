'use client'

import React from 'react'
import { CashFlowData } from '@/data/cashflow'
import { formatCurrency } from '@/lib/utils'

interface AccountTableProps {
  data: CashFlowData
}

export const AccountTable: React.FC<AccountTableProps> = ({ data }) => {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Category</th>
            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Account</th>
            <th className="text-right py-3 px-4 font-medium text-muted-foreground">Amount</th>
            <th className="text-right py-3 px-4 font-medium text-muted-foreground">% of Total</th>
          </tr>
        </thead>
        <tbody>
          {data.categories.map((cat) =>
            cat.accounts.map((account, i) => (
              <tr key={account.id} className="border-b last:border-0 hover:bg-muted/50">
                <td className="py-3 px-4">
                  {i === 0 && (
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="font-medium">{cat.name}</span>
                    </div>
                  )}
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: account.color }}
                    />
                    {account.name}
                  </div>
                </td>
                <td className="py-3 px-4 text-right font-mono">
                  {formatCurrency(account.value)}
                </td>
                <td className="py-3 px-4 text-right text-muted-foreground">
                  {((account.value / data.totalInput) * 100).toFixed(1)}%
                </td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 font-semibold">
            <td className="py-3 px-4" colSpan={2}>Total</td>
            <td className="py-3 px-4 text-right font-mono">{formatCurrency(data.totalInput)}</td>
            <td className="py-3 px-4 text-right">100%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
