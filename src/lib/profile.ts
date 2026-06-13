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
  current_price: number
  purchase_date?: string          // ISO date string, used for short/long-term gain classification
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

export interface Goal {
  name: string
  target_amount: number
  target_date: string
  priority: number
  current_progress: number
  monthly_contribution: number
}

export interface IncomeSources {
  source: string
  annual_amount: number
  is_w2: boolean
  employer?: string
  frequency?: string
}

export interface HouseholdMember {
  name: string
  age: number
  retirement_age: number
  is_primary: boolean
}

export interface Dependent {
  name: string
  age: number
  relationship: 'child' | 'spouse' | 'parent' | 'other'
}

export interface Liability {
  name: string
  type: 'mortgage' | 'student_loan' | 'auto_loan' | 'personal_loan' | 'credit_card' | 'other'
  balance: number
  interest_rate: number
  monthly_payment: number
  remaining_months?: number
  property_value?: number          // for mortgage — used to compute equity
}

export interface Benefits {
  health_plan_type?: 'HDHP' | 'PPO' | 'HMO' | 'EPO'
  hsa_eligible?: boolean
  hsa_ytd_contribution?: number
  fsa_eligible?: boolean
  fsa_election?: number
  has_mega_backdoor_roth?: boolean  // plan allows after-tax 401k + in-plan conversion
  after_tax_401k_ytd?: number       // YTD after-tax (non-Roth) 401k contributions
  health_plan_monthly_premium?: number
  health_plan_deductible?: number
  health_plan_oop_max?: number
  employer_hsa_contribution?: number
}

export type StockOptionType = 'ISO' | 'NSO'

export interface StockOptionGrant {
  grant_id: string
  ticker: string
  type: StockOptionType
  grant_date: string
  strike_price: number
  total_shares: number
  vested_shares: number
  unvested_shares: number
  expiration_date?: string
  early_exercise_eligible?: boolean
}

export interface SpendingCategory {
  category: string
  monthly_amount: number
}

export interface PlannedMove {
  from_state: string
  to_state: string
  planned_date: string          // ISO date
  confirmed: boolean
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
  goals?: Goal[]
  income?: IncomeSources[]
  household?: HouseholdMember[]
  dependents?: Dependent[]
  liabilities?: Liability[]
  benefits?: Benefits
  stock_options?: StockOptionGrant[]
  spending?: SpendingCategory[]
  planned_moves?: PlannedMove[]
}

const PROFILE_PATH = path.join(process.cwd(), 'profile.json')

// In-memory cache: eliminates repeated fs.readFileSync calls when many tools
// run in parallel (e.g. all 21 diagnostic tools run simultaneously).
// 5-second TTL so edits to profile.json are picked up promptly in dev.
let _profileCache: FinancialProfile | null = null
let _profileCacheAt = 0
const PROFILE_CACHE_TTL_MS = 5_000

export function loadProfile(): FinancialProfile {
  const now = Date.now()
  if (_profileCache && now - _profileCacheAt < PROFILE_CACHE_TTL_MS) {
    return _profileCache
  }
  const raw = fs.readFileSync(PROFILE_PATH, 'utf-8')
  _profileCache = JSON.parse(raw) as FinancialProfile
  _profileCacheAt = now
  return _profileCache
}

export function invalidateProfileCache(): void {
  _profileCache = null
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

/** Returns current market value for a holding, falling back to cost basis if no current price. */
export function holdingMarketValue(h: Holding): number {
  const price = h.current_price > 0 ? h.current_price : h.cost_basis_per_share
  return h.shares * price
}

/** Returns total cost basis for a holding. Returns null if cost basis is unknown (0 in tax-advantaged accounts). */
export function holdingCostBasis(h: Holding): number | null {
  if (h.cost_basis_per_share <= 0) return null
  return h.shares * h.cost_basis_per_share
}

/** Returns days held, or null if no purchase_date. */
export function daysHeld(h: Holding, asOfDate = new Date()): number | null {
  if (!h.purchase_date) return null
  const purchase = new Date(h.purchase_date)
  return Math.floor((asOfDate.getTime() - purchase.getTime()) / (1000 * 60 * 60 * 24))
}

export function isLongTermGain(h: Holding, asOfDate = new Date()): boolean | null {
  const days = daysHeld(h, asOfDate)
  if (days === null) return null
  return days > 365
}
