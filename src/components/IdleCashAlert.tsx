import React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { CashFlowData } from '@/data/cashflow'
import { formatCurrency } from '@/lib/utils'
import { AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react'

interface IdleCashAlertProps {
  data: CashFlowData
}

export const IdleCashAlert: React.FC<IdleCashAlertProps> = ({ data }) => {
  const cashCategory = data.categories.find((c) => c.id === 'cash')
  if (!cashCategory) return null

  const totalCash = cashCategory.accounts.reduce((s, a) => s + a.value, 0)
  const excess = totalCash - data.targetEmergencyFund
  const isExcessive = excess > 0

  if (!isExcessive) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/50">
        <CardContent className="flex items-center gap-3 py-4">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
          <div className="text-sm">
            <span className="font-medium text-emerald-800">Cash position is efficient.</span>{' '}
            <span className="text-emerald-700">
              Your {formatCurrency(totalCash)} in cash matches your {formatCurrency(data.targetEmergencyFund)} emergency fund target.
            </span>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-amber-200 bg-amber-50/50">
      <CardContent className="py-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-2">
            <div className="text-sm">
              <span className="font-medium text-amber-800">
                {formatCurrency(excess)} idle cash detected.
              </span>{' '}
              <span className="text-amber-700">
                You have {formatCurrency(totalCash)} in cash accounts but only need{' '}
                {formatCurrency(data.targetEmergencyFund)} for your emergency fund.
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-amber-700">
              <ArrowRight className="h-3 w-3" />
              <span>
                Consider moving {formatCurrency(excess)} into tax-advantaged accounts where it can grow more efficiently.
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
