import { SankeyFlow } from '@/components/SankeyFlow'
import { SummaryCards } from '@/components/SummaryCards'
import { BreakdownChart } from '@/components/BreakdownChart'
import { AccountTable } from '@/components/AccountTable'
import { ContributionLimits } from '@/components/ContributionLimits'
import { TargetVsActual } from '@/components/TargetVsActual'
import { TaxEfficiencyScore } from '@/components/TaxEfficiencyScore'
import { MonthlyTrends } from '@/components/MonthlyTrends'
import { IdleCashAlert } from '@/components/IdleCashAlert'
import { Rebalancing } from '@/components/Rebalancing'
import { ChatPanel } from '@/components/ChatPanel'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cashFlowData } from '@/data/cashflow'
import { formatCurrency } from '@/lib/utils'

function App() {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Cash Flow Visualizer</h1>
              <p className="text-muted-foreground mt-1">
                Total annual allocation: {formatCurrency(cashFlowData.totalInput)}
              </p>
            </div>
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Monthly Review</div>
              <div className="text-lg font-semibold">
                {monthNames[cashFlowData.currentMonth - 1]} 2025
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-8 space-y-8">
        {/* Agent Chat + Alerts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <ChatPanel />
          <div className="space-y-4">
            <IdleCashAlert data={cashFlowData} />
            <Rebalancing data={cashFlowData} />
          </div>
        </div>

        {/* Summary Cards */}
        <SummaryCards data={cashFlowData} />

        {/* Tax Efficiency + Contribution Limits */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <TaxEfficiencyScore data={cashFlowData} />
          <ContributionLimits data={cashFlowData} />
        </div>

        {/* Sankey Flow Diagram */}
        <Card>
          <CardHeader>
            <CardTitle>Money Flow</CardTitle>
            <CardDescription>
              How your cash input flows through account categories into individual accounts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SankeyFlow data={cashFlowData} />
          </CardContent>
        </Card>

        {/* Target vs Actual */}
        <TargetVsActual data={cashFlowData} />

        {/* Trends + Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <MonthlyTrends data={cashFlowData} />
          <Card>
            <CardHeader>
              <CardTitle>Account Breakdown</CardTitle>
              <CardDescription>
                Contribution amount by individual account
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BreakdownChart data={cashFlowData} />
            </CardContent>
          </Card>
        </div>

        {/* Detail Table */}
        <Card>
          <CardHeader>
            <CardTitle>Account Details</CardTitle>
            <CardDescription>
              Full breakdown of allocations across all accounts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AccountTable data={cashFlowData} />
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

export default App
