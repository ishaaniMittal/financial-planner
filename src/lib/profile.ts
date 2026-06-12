import fs from 'fs'
import path from 'path'

export type AccountTaxTreatment = 'tax_free' | 'tax_deferred' | 'taxable' | 'cash'
export type AssetClass =
  | 'us_equity_large' | 'us_equity_small'
  | 'intl_equity_developed' | 'intl_equity_emerging'
  | 'us_bonds' | 'intl_bonds' | 'reits' | 'tips'
  | 'commodities' | 'crypto' | 'cash_equivalent'

export interface Holding {
  ticker: string
  shares: number
  asset_class: AssetClass
  cost_basis_per_share: number
  dividend_yield: number
  turnover_rate: number
  expense_ratio: number
}

export interface Account {
  id: string
  name: string
  institution: string
  tax_treatment: AccountTaxTreatment
  balance: number
  annual_contribution_limit: number | null
  ytd_contribution: number
  target_allocation_pct: number
  holdings: Holding[]
  employer_match_pct: number
  employer_match_limit: number
}

export interface MonthlySnapshot {
  month: string
  tax_free: number
  tax_deferred: number
  taxable: number
  cash: number
}

export interface TaxSnapshot {
  filing_status: string
  state: string
  estimated_agi: number
  marginal_federal_rate: number
  marginal_state_rate: number
  long_term_cap_gains_rate: number
  net_investment_income_tax: number
}

export interface FinancialProfile {
  accounts: Account[]
  monthly_history: MonthlySnapshot[]
  tax: TaxSnapshot
  current_month: number
  current_year: number
  total_annual_investable: number
  target_emergency_fund: number
  risk_tolerance: string
}

const PROFILE_PATH = path.join(process.cwd(), 'profile.json')

export function loadProfile(): FinancialProfile {
  const raw = fs.readFileSync(PROFILE_PATH, 'utf-8')
  return JSON.parse(raw) as FinancialProfile
}

export function totalBalance(profile: FinancialProfile): number {
  return profile.accounts.reduce((s, a) => s + a.balance, 0)
}

export function totalCash(profile: FinancialProfile): number {
  return profile.accounts
    .filter(a => a.tax_treatment === 'cash')
    .reduce((s, a) => s + a.balance, 0)
}

export function excessCash(profile: FinancialProfile): number {
  return Math.max(0, totalCash(profile) - profile.target_emergency_fund)
}
