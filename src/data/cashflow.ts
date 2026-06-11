export interface Account {
  id: string
  name: string
  value: number
  color: string
  annualLimit?: number // IRS contribution limit (undefined = no cap)
  ytdContribution: number // how much contributed so far this year
  targetAllocationPct: number // target % of total input
}

export interface AccountCategory {
  id: string
  name: string
  description: string
  color: string
  accounts: Account[]
  taxEfficiencyWeight: number // 1.0 = best (tax-free), 0.25 = worst (cash)
}

export interface MonthlySnapshot {
  month: string // e.g. "Jan", "Feb"
  taxFree: number
  taxDeferred: number
  taxable: number
  cash: number
}

export interface CashFlowData {
  totalInput: number
  targetEmergencyFund: number // ideal cash reserve
  currentMonth: number // 1-indexed, e.g. 6 = June
  categories: AccountCategory[]
  monthlyHistory: MonthlySnapshot[]
}

export const cashFlowData: CashFlowData = {
  totalInput: 150000,
  targetEmergencyFund: 18000, // 3 months expenses
  currentMonth: 6, // June
  categories: [
    {
      id: 'tax-free',
      name: 'Tax-Free',
      description: 'Contributions grow and withdraw tax-free',
      color: '#10b981',
      taxEfficiencyWeight: 1.0,
      accounts: [
        {
          id: 'roth-401k',
          name: 'Roth 401(k)',
          value: 23000,
          color: '#34d399',
          annualLimit: 23500,
          ytdContribution: 11500,
          targetAllocationPct: 15.3,
        },
        {
          id: 'roth-ira',
          name: 'Roth IRA',
          value: 7000,
          color: '#6ee7b7',
          annualLimit: 7000,
          ytdContribution: 7000,
          targetAllocationPct: 4.7,
        },
        {
          id: 'hsa',
          name: 'HSA',
          value: 4150,
          color: '#a7f3d0',
          annualLimit: 4300,
          ytdContribution: 2150,
          targetAllocationPct: 2.8,
        },
      ],
    },
    {
      id: 'tax-deferred',
      name: 'Tax-Deferred',
      description: 'Contributions reduce taxable income now, taxed on withdrawal',
      color: '#3b82f6',
      taxEfficiencyWeight: 0.75,
      accounts: [
        {
          id: 'trad-401k',
          name: 'Traditional 401(k)',
          value: 23000,
          color: '#60a5fa',
          annualLimit: 23500,
          ytdContribution: 11500,
          targetAllocationPct: 15.3,
        },
        {
          id: 'trad-ira',
          name: 'Traditional IRA',
          value: 7000,
          color: '#93c5fd',
          annualLimit: 7000,
          ytdContribution: 3500,
          targetAllocationPct: 4.7,
        },
        {
          id: '457b',
          name: '457(b)',
          value: 10000,
          color: '#bfdbfe',
          annualLimit: 23500,
          ytdContribution: 5000,
          targetAllocationPct: 6.7,
        },
      ],
    },
    {
      id: 'taxable',
      name: 'Taxable',
      description: 'Investment gains taxed as capital gains',
      color: '#f59e0b',
      taxEfficiencyWeight: 0.5,
      accounts: [
        {
          id: 'brokerage',
          name: 'Brokerage Account',
          value: 35000,
          color: '#fbbf24',
          ytdContribution: 17500,
          targetAllocationPct: 23.3,
        },
        {
          id: 'espp',
          name: 'ESPP',
          value: 12000,
          color: '#fcd34d',
          annualLimit: 25000,
          ytdContribution: 6000,
          targetAllocationPct: 8.0,
        },
        {
          id: 'crypto',
          name: 'Crypto',
          value: 5000,
          color: '#fde68a',
          ytdContribution: 2500,
          targetAllocationPct: 3.3,
        },
      ],
    },
    {
      id: 'cash',
      name: 'Cash & Savings',
      description: 'Liquid funds for emergencies and short-term goals',
      color: '#8b5cf6',
      taxEfficiencyWeight: 0.25,
      accounts: [
        {
          id: 'hysa',
          name: 'High-Yield Savings',
          value: 15000,
          color: '#a78bfa',
          ytdContribution: 15000,
          targetAllocationPct: 10.0,
        },
        {
          id: 'checking',
          name: 'Checking',
          value: 5000,
          color: '#c4b5fd',
          ytdContribution: 5000,
          targetAllocationPct: 3.3,
        },
        {
          id: 'money-market',
          name: 'Money Market',
          value: 3850,
          color: '#ddd6fe',
          ytdContribution: 3850,
          targetAllocationPct: 2.6,
        },
      ],
    },
  ],
  monthlyHistory: [
    { month: 'Jan', taxFree: 5600, taxDeferred: 6200, taxable: 7500, cash: 4200 },
    { month: 'Feb', taxFree: 5600, taxDeferred: 6200, taxable: 8000, cash: 3000 },
    { month: 'Mar', taxFree: 5800, taxDeferred: 6500, taxable: 8500, cash: 2800 },
    { month: 'Apr', taxFree: 5500, taxDeferred: 6800, taxable: 9000, cash: 3200 },
    { month: 'May', taxFree: 5700, taxDeferred: 7000, taxable: 9500, cash: 2500 },
    { month: 'Jun', taxFree: 5950, taxDeferred: 7300, taxable: 9500, cash: 2650 },
  ],
}
