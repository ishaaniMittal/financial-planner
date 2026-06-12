import { useState } from 'react'
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
import { ReportDashboard } from '@/components/ReportDashboard'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cashFlowData } from '@/data/cashflow'
import { formatCurrency } from '@/lib/utils'
import { LayoutDashboard, MessageSquare, BarChart3 } from 'lucide-react'

type Tab = 'overview' | 'reports' | 'chat'

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('overview')
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

          {/* Tab Navigation */}
          <nav className="flex gap-1 mt-6 border-b -mb-px">
            <button
              onClick={() => setActiveTab('overview')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'overview'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <BarChart3 className="h-4 w-4" />
              Overview
            </button>
            <button
              onClick={() => setActiveTab('reports')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'reports'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <LayoutDashboard className="h-4 w-4" />
              Reports
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'chat'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <MessageSquare className="h-4 w-4" />
              Advisor
            </button>
          </nav>
        </div>
      </header>

      <main className="container py-8">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-8">
            <IdleCashAlert data={cashFlowData} />
            <SummaryCards data={cashFlowData} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <TaxEfficiencyScore data={cashFlowData} />
              <ContributionLimits data={cashFlowData} />
            </div>

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

            <TargetVsActual data={cashFlowData} />

            <Rebalancing data={cashFlowData} />

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
          </div>
        )}

        {/* Reports Tab */}
        {activeTab === 'reports' && (
          <ReportDashboard />
        )}

        {/* Chat/Advisor Tab */}
        {activeTab === 'chat' && (
          <div className="max-w-4xl mx-auto">
            <ChatPanel />
          </div>
        )}
      </main>
    </div>
  )
}

export default App
