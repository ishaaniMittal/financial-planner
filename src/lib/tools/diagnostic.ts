import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { loadProfile, holdingMarketValue, holdingCostBasis, isLongTermGain, excessCash, totalCash } from '../profile'
import {
  federalMarginalRate, federalTaxOwed, roomInCurrentBracket,
  ROTH_IRA_PHASEOUT, getBrackets, getStateRate, tentativeMinimumTax,
  CONTRIBUTION_LIMITS, ANNUAL_GIFT_EXCLUSION, LIFETIME_ESTATE_EXEMPTION,
} from '../tax-data'

type Priority = 'critical' | 'high' | 'medium' | 'low'

interface Finding {
  priority: Priority
  action: string
  detail: string
  estimated_impact?: string   // dollar or % impact if quantifiable
  tool_for_details?: string   // which tool to call for a full deep-dive
}

interface DiagnosticCategory {
  category: string
  score: 'needs_attention' | 'good' | 'not_enough_data'
  findings: Finding[]
}

function projectPortfolio(pv: number, annual: number, r: number, years: number) {
  return pv * Math.pow(1 + r, years) + annual * ((Math.pow(1 + r, years) - 1) / r)
}

const PLACEMENT_AVOID: Record<string, string> = {
  us_bonds: 'taxable', intl_bonds: 'none', reits: 'taxable',
  tips: 'taxable', commodities: 'taxable',
  intl_equity_developed: 'tax_deferred', intl_equity_emerging: 'tax_deferred',
}

export const runFinancialDiagnostic = tool({
  description: `Run a complete financial health diagnostic across all planning categories.
Returns a prioritized list of action items organized by category — like a financial planning
checklist customized to the user's actual data. Use this when the user asks where to start,
what to work on, or wants a full picture of their financial situation.
Also flags what profile data is missing and what additional information would unlock better analysis.`,
  inputSchema: zodSchema(z.object({
    annual_return_pct: z.number().optional().describe('Expected portfolio return for projections. Defaults to 7.0.'),
  })),
  execute: async ({ annual_return_pct = 7.0 }) => {
    const profile = loadProfile()
    const mfj = profile.tax.filing_status === 'married_filing_jointly'
    const filingStatus = profile.tax.filing_status
    const agi = profile.tax.estimated_agi
    const stateRate = profile.tax.marginal_state_rate
    const currentMonth = profile.current_month
    const expectedPct = currentMonth / 12
    const monthsLeft = 12 - currentMonth
    const now = new Date()
    const categories: DiagnosticCategory[] = []

    // -----------------------------------------------------------------------
    // 1. CASH FLOW & CONTRIBUTIONS
    // -----------------------------------------------------------------------
    {
      const findings: Finding[] = []

      // Employer match
      const salaryIncome = profile.income?.filter(i => i.is_w2 && i.source === 'salary').reduce((s,i) => s + i.annual_amount, 0) ?? 0
      for (const acct of profile.accounts.filter(a => a.employer_match_pct > 0)) {
        const annualized = currentMonth > 0 ? acct.ytd_contribution * 12 / currentMonth : acct.ytd_contribution
        const matchAvailable = Math.min(salaryIncome * acct.employer_match_pct, acct.employer_match_limit)
        const matchCaptured = Math.min(annualized * acct.employer_match_pct, acct.employer_match_limit)
        const missed = matchAvailable - matchCaptured
        if (missed > 50) {
          findings.push({
            priority: 'critical',
            action: `Increase ${acct.name} deferral to capture full employer match`,
            detail: `Missing $${Math.round(missed).toLocaleString()}/yr in employer match — a 100% guaranteed return. Need to contribute ${((acct.employer_match_limit / acct.employer_match_pct) / salaryIncome * 100).toFixed(1)}% of salary minimum.`,
            estimated_impact: `+$${Math.round(missed).toLocaleString()}/yr`,
            tool_for_details: 'check_employer_match',
          })
        }
      }

      // Contribution pace
      const behind = profile.accounts.filter(a => {
        if (!a.annual_contribution_limit) return false
        return (a.ytd_contribution / a.annual_contribution_limit) < (expectedPct - 0.1)
      })
      if (behind.length) {
        const totalRemaining = behind.reduce((s, a) => s + (a.annual_contribution_limit! - a.ytd_contribution), 0)
        findings.push({
          priority: 'high',
          action: `Increase contributions to ${behind.length} account(s) behind pace`,
          detail: `${behind.map(a => a.name).join(', ')} are behind the expected ${Math.round(expectedPct * 100)}% pace. $${totalRemaining.toLocaleString()} remaining across these accounts with ${monthsLeft} months left.`,
          estimated_impact: `$${Math.round(totalRemaining / Math.max(monthsLeft, 1)).toLocaleString()}/mo needed`,
          tool_for_details: 'check_contribution_pace',
        })
      }

      // Idle cash
      const excess = excessCash(profile)
      if (excess > 1000) {
        const opportunityCost = Math.round(excess * (annual_return_pct / 100 - 0.045))
        findings.push({
          priority: excess > 10000 ? 'high' : 'medium',
          action: `Deploy $${excess.toLocaleString()} excess cash beyond emergency fund`,
          detail: `$${excess.toLocaleString()} is sitting idle above your $${profile.target_emergency_fund.toLocaleString()} emergency fund target.`,
          estimated_impact: `~$${opportunityCost.toLocaleString()}/yr opportunity cost`,
          tool_for_details: 'detect_idle_cash',
        })
      }

      // Savings rate check — use spending data if available, else fall back to contribution proxy
      const totalIncome = profile.income?.reduce((s,i) => s + i.annual_amount, 0) ?? 0
      const totalYtdContribs = profile.accounts.reduce((s,a) => s + a.ytd_contribution, 0)
      const annualizedContribs = currentMonth > 0 ? totalYtdContribs * 12 / currentMonth : totalYtdContribs
      const spending = profile.spending ?? []
      const hasSpending = spending.length > 0
      if (hasSpending && totalIncome > 0) {
        const totalMonthlySpend = spending.reduce((s,c) => s + c.monthly_amount, 0)
        const totalAnnualSpend = totalMonthlySpend * 12
        const grossSavings = totalIncome - totalAnnualSpend
        const grossSavingsRate = grossSavings / totalIncome
        if (grossSavingsRate < 0.20) {
          findings.push({
            priority: grossSavingsRate < 0.10 ? 'high' : 'medium',
            action: `Savings rate is ${(grossSavingsRate * 100).toFixed(0)}% — review spending to improve`,
            detail: `Gross income $${Math.round(totalIncome/12).toLocaleString()}/mo, spending $${Math.round(totalMonthlySpend).toLocaleString()}/mo, implied savings $${Math.round(grossSavings/12).toLocaleString()}/mo. For FIRE targets, 30-50%+ is typically needed.`,
            estimated_impact: `Each 5% improvement = $${Math.round(totalIncome * 0.05 / 12).toLocaleString()}/mo more invested`,
            tool_for_details: 'calculate_savings_rate',
          })
        }
      } else {
        const savingsRate = totalIncome > 0 ? annualizedContribs / totalIncome : 0
        if (savingsRate < 0.20 && totalIncome > 0) {
          findings.push({
            priority: 'medium',
            action: 'Review overall savings rate',
            detail: `Annualized retirement contributions are ~${(savingsRate * 100).toFixed(0)}% of gross income. Add spending data for a complete picture.`,
            tool_for_details: 'calculate_savings_rate',
          })
        }
      }

      categories.push({
        category: 'Cash Flow & Contributions',
        score: findings.some(f => f.priority === 'critical' || f.priority === 'high') ? 'needs_attention' : 'good',
        findings,
      })
    }

    // -----------------------------------------------------------------------
    // 2. TAX EFFICIENCY
    // -----------------------------------------------------------------------
    {
      const findings: Finding[] = []

      // Roth eligibility
      const phaseout = ROTH_IRA_PHASEOUT[filingStatus] ?? ROTH_IRA_PHASEOUT.single
      const rothIraAccounts = profile.accounts.filter(a => a.tax_treatment === 'tax_free' && a.name.toLowerCase().includes('ira'))
      const totalRothContrib = rothIraAccounts.reduce((s,a) => s + a.ytd_contribution, 0)
      if (agi >= phaseout.end && totalRothContrib > 0) {
        findings.push({
          priority: 'critical',
          action: 'Correct excess Roth IRA contribution — switch to backdoor Roth',
          detail: `Your MAGI ($${agi.toLocaleString()}) exceeds the ${mfj ? 'MFJ' : 'single'} Roth IRA limit ($${phaseout.end.toLocaleString()}). The $${totalRothContrib.toLocaleString()} direct Roth IRA contribution may be an excess contribution subject to 6%/yr penalty.`,
          tool_for_details: 'check_roth_eligibility',
        })
      } else if (agi >= phaseout.start && agi < phaseout.end) {
        findings.push({
          priority: 'high',
          action: 'Switch to backdoor Roth — in phaseout range',
          detail: `MAGI ($${agi.toLocaleString()}) is in the Roth IRA phaseout range ($${phaseout.start.toLocaleString()}–$${phaseout.end.toLocaleString()}). Direct contribution is partially limited.`,
          tool_for_details: 'check_roth_eligibility',
        })
      }

      // Asset location misplacements
      let misplacedCount = 0
      let estDrag = 0
      for (const acct of profile.accounts) {
        if (acct.tax_treatment === 'cash') continue
        for (const h of acct.holdings) {
          const avoid = PLACEMENT_AVOID[h.asset_class]
          if (avoid && acct.tax_treatment === avoid) {
            misplacedCount++
            const val = holdingMarketValue(h)
            estDrag += val * (h.dividend_yield / 100) * (profile.tax.marginal_federal_rate + stateRate) * 0.5
          }
        }
      }
      if (misplacedCount > 0) {
        findings.push({
          priority: 'high',
          action: `Reposition ${misplacedCount} misplaced holding(s) to more tax-efficient accounts`,
          detail: 'Holdings are in account types that maximize tax drag (e.g. bonds in taxable, international equity in tax-deferred).',
          estimated_impact: `~$${Math.round(estDrag).toLocaleString()}/yr in avoidable tax drag`,
          tool_for_details: 'optimize_asset_location',
        })
      }

      // Roth conversion opportunity
      const taxDeferredBalance = profile.accounts.filter(a => a.tax_treatment === 'tax_deferred').reduce((s,a) => s + a.balance, 0)
      const room = roomInCurrentBracket(agi, filingStatus)
      if (taxDeferredBalance > 10000 && room > 5000) {
        const conversionTax = (federalTaxOwed(agi + room, filingStatus) - federalTaxOwed(agi, filingStatus)) + room * stateRate
        const effectiveRate = conversionTax / room * 100
        findings.push({
          priority: 'medium',
          action: 'Evaluate Roth conversion to fill current bracket',
          detail: `$${Math.round(room).toLocaleString()} of room remains in your current ${(federalMarginalRate(agi, filingStatus) * 100).toFixed(0)}% bracket. Converting now at ~${effectiveRate.toFixed(0)}% may be cheaper than RMDs in retirement.`,
          estimated_impact: `Convert up to $${Math.round(room).toLocaleString()}/yr at ${(federalMarginalRate(agi, filingStatus) * 100).toFixed(0)}% marginal rate`,
          tool_for_details: 'plan_roth_conversion',
        })
      }

      // Tax-loss harvesting
      let tlhCandidates = 0
      for (const acct of profile.accounts.filter(a => a.tax_treatment === 'taxable')) {
        for (const h of acct.holdings) {
          const cb = holdingCostBasis(h)
          if (cb === null) continue
          const mv = holdingMarketValue(h)
          if (mv < cb - 500) tlhCandidates++
        }
      }
      if (tlhCandidates > 0) {
        findings.push({
          priority: 'medium',
          action: `Review ${tlhCandidates} tax-loss harvesting candidate(s) in taxable accounts`,
          detail: 'One or more taxable holdings are below cost basis and may be harvestable to offset gains.',
          tool_for_details: 'analyze_tax_opportunities',
        })
      }

      categories.push({
        category: 'Tax Efficiency',
        score: findings.some(f => f.priority === 'critical' || f.priority === 'high') ? 'needs_attention' : 'good',
        findings,
      })
    }

    // -----------------------------------------------------------------------
    // 3. RETIREMENT & GOALS
    // -----------------------------------------------------------------------
    {
      const findings: Finding[] = []
      const r = annual_return_pct / 100
      const primaryMember = profile.household?.find(h => h.is_primary)
      const yearsToRetirement = primaryMember ? primaryMember.retirement_age - primaryMember.age : 20

      // Portfolio value
      let portfolioValue = profile.accounts.filter(a => a.tax_treatment !== 'cash').reduce((s,a) => s + a.balance, 0)
      const annualContrib = profile.total_annual_investable ?? 0

      // FIRE goal
      const fireGoal = profile.goals?.find(g => g.name.toLowerCase().includes('retire') || g.name.toLowerCase().includes('fire'))
      if (fireGoal) {
        const targetDate = new Date(fireGoal.target_date)
        const yearsLeft = Math.max(0, (targetDate.getTime() - now.getTime()) / (365.25 * 86400000))
        const projected = yearsLeft > 0 ? projectPortfolio(portfolioValue, annualContrib, r, yearsLeft) : portfolioValue
        const onTrack = projected >= fireGoal.target_amount
        const gap = fireGoal.target_amount - projected

        if (!onTrack) {
          const fvFactor = r > 0 ? (Math.pow(1+r, yearsLeft) - 1) / r : yearsLeft
          const fvLump = portfolioValue * Math.pow(1+r, yearsLeft)
          const requiredAnnual = fvFactor > 0 ? Math.round((fireGoal.target_amount - fvLump) / fvFactor) : 0
          const shortfall = Math.max(0, requiredAnnual - annualContrib)
          findings.push({
            priority: 'high',
            action: `Increase savings rate to stay on track for ${fireGoal.name}`,
            detail: `Projected portfolio by ${targetDate.getFullYear()}: $${Math.round(projected).toLocaleString()} vs $${fireGoal.target_amount.toLocaleString()} target. Gap: $${Math.round(gap).toLocaleString()}.`,
            estimated_impact: `Need $${requiredAnnual.toLocaleString()}/yr vs current $${annualContrib.toLocaleString()}/yr (+$${shortfall.toLocaleString()}/yr)`,
            tool_for_details: 'project_retirement',
          })
        } else {
          findings.push({
            priority: 'low',
            action: `${fireGoal.name} is on track`,
            detail: `Projected $${Math.round(projected).toLocaleString()} by ${targetDate.getFullYear()} vs $${fireGoal.target_amount.toLocaleString()} target at ${annual_return_pct}% returns.`,
            tool_for_details: 'project_retirement',
          })
        }
      }

      // Non-retirement goals
      for (const goal of (profile.goals ?? []).filter(g => !g.name.toLowerCase().includes('retire') && !g.name.toLowerCase().includes('fire'))) {
        const targetDate = new Date(goal.target_date)
        const yearsLeft = Math.max(0, (targetDate.getTime() - now.getTime()) / (365.25 * 86400000))
        const shortTermRate = yearsLeft < 3 ? 0.04 : r
        const projected = yearsLeft > 0 ? projectPortfolio(goal.current_progress, (goal.monthly_contribution ?? 0) * 12, shortTermRate, yearsLeft) : goal.current_progress
        const onTrack = projected >= goal.target_amount
        if (!onTrack) {
          const gap = goal.target_amount - projected
          findings.push({
            priority: yearsLeft < 2 ? 'high' : 'medium',
            action: `Increase funding for goal: ${goal.name}`,
            detail: `Projected $${Math.round(projected).toLocaleString()} by ${targetDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short' })} vs $${goal.target_amount.toLocaleString()} target. Gap: $${Math.round(gap).toLocaleString()}.`,
            tool_for_details: 'analyze_goal_funding',
          })
        }
      }

      categories.push({
        category: 'Retirement & Goals',
        score: findings.some(f => f.priority === 'critical' || f.priority === 'high') ? 'needs_attention' : 'good',
        findings,
      })
    }

    // -----------------------------------------------------------------------
    // 4. PORTFOLIO HEALTH
    // -----------------------------------------------------------------------
    {
      const findings: Finding[] = []

      // Asset class allocation
      const EQUITY_CLASSES = new Set(['us_equity_large','us_equity_small','intl_equity_developed','intl_equity_emerging','reits'])
      const BOND_CLASSES = new Set(['us_bonds','intl_bonds','tips'])
      let equityVal = 0, bondVal = 0, totalPortVal = 0
      const tickerTotals: Record<string, number> = {}

      for (const acct of profile.accounts) {
        if (acct.tax_treatment === 'cash') continue
        for (const h of acct.holdings) {
          const val = holdingMarketValue(h)
          totalPortVal += val
          if (EQUITY_CLASSES.has(h.asset_class)) equityVal += val
          if (BOND_CLASSES.has(h.asset_class)) bondVal += val
          tickerTotals[h.ticker] = (tickerTotals[h.ticker] ?? 0) + val
        }
        if (acct.holdings.length === 0) { totalPortVal += acct.balance; equityVal += acct.balance }
      }
      if (totalPortVal === 0) totalPortVal = profile.accounts.filter(a => a.tax_treatment !== 'cash').reduce((s,a) => s + a.balance, 0)

      const primaryMember = profile.household?.find(h => h.is_primary)
      const yearsToRetirement = primaryMember ? primaryMember.retirement_age - primaryMember.age : 20
      const riskToleranceMap: Record<string, number> = { conservative: 40, moderate: 60, aggressive: 80, 'very aggressive': 90 }
      const targetEquity = riskToleranceMap[profile.risk_tolerance?.toLowerCase() ?? 'moderate'] ?? 70
      const currentEquityPct = totalPortVal > 0 ? equityVal / totalPortVal * 100 : 0
      const drift = Math.abs(currentEquityPct - targetEquity)

      if (drift > 10) {
        findings.push({
          priority: 'high',
          action: `Rebalance portfolio — equity allocation is ${currentEquityPct.toFixed(0)}% vs ${targetEquity}% target`,
          detail: `${currentEquityPct > targetEquity ? 'Over' : 'Under'}-weight in equities by ${drift.toFixed(0)}pp for your ${profile.risk_tolerance} risk tolerance.`,
          tool_for_details: 'analyze_asset_class_allocation',
        })
      } else if (drift > 5) {
        findings.push({
          priority: 'medium',
          action: 'Minor equity allocation drift — monitor and redirect contributions',
          detail: `Equity at ${currentEquityPct.toFixed(0)}% vs ${targetEquity}% target. Within 10pp — redirect new contributions to correct without selling.`,
          tool_for_details: 'analyze_asset_class_allocation',
        })
      }

      // Concentration risk
      const concentrated = Object.entries(tickerTotals).filter(([,v]) => totalPortVal > 0 && v / totalPortVal > 0.20)
      for (const [ticker, val] of concentrated) {
        findings.push({
          priority: 'high',
          action: `Reduce concentration in ${ticker} (${(val/totalPortVal*100).toFixed(0)}% of portfolio)`,
          detail: `$${Math.round(val).toLocaleString()} in ${ticker} exceeds 20% of invested portfolio. Single-stock risk is significant.`,
          tool_for_details: 'analyze_holdings',
        })
      }

      // Expense ratio check — flag any holding with ER > 0.5%
      let highErCount = 0, totalAnnualFees = 0
      for (const acct of profile.accounts) {
        for (const h of acct.holdings) {
          const val = holdingMarketValue(h)
          totalAnnualFees += val * h.expense_ratio / 100
          if (h.expense_ratio > 0.5) highErCount++
        }
      }
      if (highErCount > 0) {
        findings.push({
          priority: 'medium',
          action: `Review ${highErCount} high-fee holding(s) — cheaper alternatives likely exist`,
          detail: `Total estimated annual fund fees: $${Math.round(totalAnnualFees).toLocaleString()}/yr. One or more funds have expense ratios above 0.5%.`,
          tool_for_details: 'analyze_fund_overlap',
        })
      } else if (totalAnnualFees > 500) {
        findings.push({
          priority: 'low',
          action: 'Review fund fees for substitution opportunities',
          detail: `Total estimated annual fund fees: $${Math.round(totalAnnualFees).toLocaleString()}/yr. Run a fund overlap scan to check for cheaper alternatives.`,
          tool_for_details: 'analyze_fund_overlap',
        })
      }

      categories.push({
        category: 'Portfolio Health',
        score: findings.some(f => f.priority === 'critical' || f.priority === 'high') ? 'needs_attention' : 'good',
        findings,
      })
    }

    // -----------------------------------------------------------------------
    // 5. BENEFITS & EQUITY COMP
    // -----------------------------------------------------------------------
    {
      const findings: Finding[] = []

      // RSU income in profile
      const rsuIncome = profile.income?.filter(i => i.source === 'rsu').reduce((s,i) => s + i.annual_amount, 0) ?? 0
      if (rsuIncome > 0) {
        // Withholding shortfall estimate
        const baseAgi = agi - rsuIncome
        const marginalOnRsu = (federalTaxOwed(agi, filingStatus) - federalTaxOwed(baseAgi, filingStatus)) + rsuIncome * stateRate
        const withheld = rsuIncome * 0.22
        const shortfall = marginalOnRsu - withheld
        if (shortfall > 1000) {
          findings.push({
            priority: 'high',
            action: 'Make estimated tax payments for RSU withholding shortfall',
            detail: `RSUs are withheld at 22% flat but your marginal rate is higher. Estimated shortfall: $${Math.round(shortfall).toLocaleString()}/yr. Underpayment penalty applies if not corrected.`,
            estimated_impact: `$${Math.round(shortfall).toLocaleString()} tax due beyond withholding`,
            tool_for_details: 'plan_rsu_taxes',
          })
        }
        // ESPP concentration
        const esppAcct = profile.accounts.find(a => a.id === 'espp')
        if (esppAcct && esppAcct.balance > 0) {
          const totalPortVal = profile.accounts.filter(a => a.tax_treatment !== 'cash').reduce((s,a) => s + a.balance, 0)
          const esppPct = esppAcct.balance / totalPortVal * 100
          if (esppPct > 10) {
            findings.push({
              priority: 'medium',
              action: 'Define disciplined ESPP/RSU sell strategy to reduce employer stock concentration',
              detail: `ESPP is ${esppPct.toFixed(0)}% of invested portfolio. Best practice: sell ESPP shares promptly after each purchase period and diversify proceeds.`,
              tool_for_details: 'analyze_tax_opportunities',
            })
          }
        }
      }

      // HSA not maxed check
      const hsaAcct = profile.accounts.find(a => a.name.toLowerCase().includes('hsa'))
      if (hsaAcct && hsaAcct.annual_contribution_limit) {
        const hsaRemaining = hsaAcct.annual_contribution_limit - hsaAcct.ytd_contribution
        if (hsaRemaining > 0) {
          findings.push({
            priority: 'medium',
            action: `Max out HSA — $${hsaRemaining.toLocaleString()} remaining`,
            detail: 'HSA is triple tax-advantaged: deductible contributions, tax-free growth, tax-free withdrawals for medical. Best account in the tax code.',
            estimated_impact: `$${Math.round(hsaRemaining * (federalMarginalRate(agi, filingStatus) + stateRate)).toLocaleString()} in tax savings`,
            tool_for_details: 'get_contribution_limits',
          })
        }
      }

      // Mega backdoor Roth
      const benefits = (profile as any).benefits ?? {}
      if (benefits.has_mega_backdoor_roth) {
        const k401 = profile.accounts.find(a => a.name.toLowerCase().includes('401') || a.id.toLowerCase().includes('401'))
        const ytdElective = k401?.ytd_contribution ?? 0
        const annualElective = currentMonth > 0 ? ytdElective * 12 / currentMonth : ytdElective
        const employerEstimate = k401
          ? Math.min((k401.employer_match_pct ?? 0) * (profile.income?.[0]?.annual_amount ?? 0), k401.employer_match_limit ?? Infinity)
          : 0
        const afterTaxYtd = benefits.after_tax_401k_ytd ?? 0
        const afterTaxAnnualized = currentMonth > 0 ? afterTaxYtd * 12 / currentMonth : afterTaxYtd
        const remaining415c = Math.max(0, CONTRIBUTION_LIMITS.k401_total_limit - annualElective - employerEstimate - afterTaxAnnualized)
        if (remaining415c > 1000) {
          findings.push({
            priority: 'high',
            action: `Use Mega Backdoor Roth — $${Math.round(remaining415c).toLocaleString()} of after-tax 401(k) capacity unused`,
            detail: `Your plan supports after-tax contributions. ${annualElective > 0 ? `$${Math.round(annualElective).toLocaleString()}` : '$0'} employee + ~$${Math.round(employerEstimate).toLocaleString()} employer = capacity for $${Math.round(remaining415c).toLocaleString()} more after-tax contributions that can convert to Roth.`,
            estimated_impact: `Up to $${Math.round(remaining415c).toLocaleString()}/yr in additional Roth space`,
            tool_for_details: 'analyze_mega_backdoor_roth',
          })
        }
      } else if (benefits.has_mega_backdoor_roth === undefined) {
        findings.push({
          priority: 'low',
          action: 'Confirm whether your 401(k) plan supports Mega Backdoor Roth',
          detail: 'Ask HR: does the plan allow after-tax (non-Roth) contributions? Is in-plan Roth conversion available? This can unlock up to ~$46,500/yr of additional Roth space.',
          tool_for_details: 'analyze_mega_backdoor_roth',
        })
      }

      // Health plan — HDHP check
      const hpType = benefits.health_plan_type
      if (hpType && hpType !== 'HDHP' && !hsaAcct) {
        findings.push({
          priority: 'medium',
          action: `Evaluate switching to HDHP + HSA — currently on ${hpType}`,
          detail: 'If healthy, HDHP premium savings + HSA triple tax advantage often beat PPO. Run a break-even analysis.',
          tool_for_details: 'compare_health_plans',
        })
      } else if (!hpType) {
        findings.push({
          priority: 'low',
          action: 'Add health plan type to profile for HDHP vs PPO analysis',
          detail: 'Profile is missing benefits.health_plan_type. Once set, the diagnostic can flag HDHP + HSA optimization opportunities.',
          tool_for_details: 'compare_health_plans',
        })
      }

      // Stock options
      const stockOptions = (profile as any).stock_options ?? []
      if (stockOptions.length > 0) {
        const isoGrants = stockOptions.filter((g: any) => g.type === 'ISO')
        const nsoGrants = stockOptions.filter((g: any) => g.type === 'NSO')
        const totalVested = stockOptions.reduce((s: number, g: any) => s + (g.vested_shares ?? 0), 0)
        if (totalVested > 0) {
          // Check for expiring grants (within 12 months)
          const soonExpiring = stockOptions.filter((g: any) => {
            if (!g.expiration_date) return false
            const exp = new Date(g.expiration_date)
            const msLeft = exp.getTime() - now.getTime()
            return msLeft > 0 && msLeft < 365 * 86400000
          })
          if (soonExpiring.length > 0) {
            findings.push({
              priority: 'critical',
              action: `${soonExpiring.length} option grant(s) expiring within 12 months — review exercise plan`,
              detail: `Grant(s) ${soonExpiring.map((g: any) => g.grant_id).join(', ')} expire soon. Unexercised options expire worthless. Run plan_stock_options for exercise cost, tax treatment, and AMT analysis.`,
              tool_for_details: 'plan_stock_options',
            })
          }
          if (isoGrants.length > 0) {
            findings.push({
              priority: 'medium',
              action: `Review ISO exercise strategy for AMT exposure (${isoGrants.length} ISO grant(s))`,
              detail: `${totalVested.toLocaleString()} total vested shares across ${stockOptions.length} grant(s). ISO spreads are AMT preference items — exercise timing matters. Use plan_stock_options with current price for full analysis.`,
              tool_for_details: 'plan_stock_options',
            })
          }
        }
      }

      // 529 for dependents
      const children = (profile as any).dependents?.filter((d: any) => d.relationship === 'child') ?? []
      if (children.length > 0) {
        const acct529 = profile.accounts.find(a => a.name.toLowerCase().includes('529'))
        if (!acct529) {
          findings.push({
            priority: 'high',
            action: `Open 529 account for ${children.map((c: any) => c.name).join(', ')}`,
            detail: `${children.length} child dependent(s) in profile but no 529 account found. Tax-free growth and withdrawals for education. The earlier you start, the more compounding.`,
            tool_for_details: 'plan_529',
          })
        } else {
          const childAge = children[0].age ?? 0
          const yearsToCollege = Math.max(1, 18 - childAge)
          const growthRate = 0.07
          const projected529 = acct529.balance * Math.pow(1 + growthRate, yearsToCollege)
          if (projected529 < 200_000) {
            findings.push({
              priority: 'medium',
              action: `529 may be underfunded — projected $${Math.round(projected529).toLocaleString()} by college`,
              detail: `${children[0].name ?? 'Child'} is ${childAge}, ~${yearsToCollege} years to college. Current 529 balance of $${acct529.balance.toLocaleString()} projects to $${Math.round(projected529).toLocaleString()} at 7%/yr — below typical 4-year university cost. Run plan_529 for required monthly contribution.`,
              tool_for_details: 'plan_529',
            })
          }
        }
      }

      categories.push({
        category: 'Benefits & Equity Compensation',
        score: findings.some(f => f.priority === 'critical' || f.priority === 'high') ? 'needs_attention' : 'good',
        findings,
      })
    }

    // -----------------------------------------------------------------------
    // 6. NET WORTH & DEBT
    // -----------------------------------------------------------------------
    {
      const findings: Finding[] = []

      const liabilities = (profile as any).liabilities ?? []
      const totalLiabilities = liabilities.reduce((s: number, l: any) => s + l.balance, 0)

      const investmentTotal = profile.accounts.filter(a => a.tax_treatment !== 'cash').reduce((s,a) => s + a.balance, 0)
      const cashTotal = profile.accounts.filter(a => a.tax_treatment === 'cash').reduce((s,a) => s + a.balance, 0)
      const mortgages = liabilities.filter((l: any) => l.type === 'mortgage')
      const realEstateValue = mortgages.reduce((s: number, m: any) => s + (m.property_value ?? 0), 0)
      const totalAssets = investmentTotal + cashTotal + realEstateValue
      const netWorth = totalAssets - totalLiabilities

      const monthlyIncome = (profile.income?.reduce((s,i) => s + i.annual_amount, 0) ?? 0) / 12
      const monthlyDebt = liabilities.reduce((s: number, l: any) => s + (l.monthly_payment ?? 0), 0)
      const dti = monthlyIncome > 0 ? monthlyDebt / monthlyIncome : null

      if (liabilities.length > 0) {
        // High-interest debt check
        const highInterest = liabilities.filter((l: any) => l.interest_rate > 7 && l.type !== 'mortgage')
        if (highInterest.length > 0) {
          const hiTotal = highInterest.reduce((s: number, l: any) => s + l.balance, 0)
          findings.push({
            priority: 'high',
            action: `Pay down ${highInterest.length} high-interest debt(s) before investing`,
            detail: `${highInterest.map((l: any) => `${l.name} (${l.interest_rate}%)`).join(', ')} — total $${Math.round(hiTotal).toLocaleString()}. Guaranteed return equals the interest rate, likely better than market after tax.`,
            estimated_impact: `~$${Math.round(hiTotal * highInterest[0].interest_rate / 100).toLocaleString()}/yr in interest saved`,
            tool_for_details: 'calculate_net_worth',
          })
        }
        // DTI check
        if (dti !== null && dti > 0.36) {
          findings.push({
            priority: 'high',
            action: `Reduce debt-to-income ratio (currently ${(dti * 100).toFixed(0)}%)`,
            detail: `Monthly debt payments ($${Math.round(monthlyDebt).toLocaleString()}) are ${(dti * 100).toFixed(0)}% of gross monthly income ($${Math.round(monthlyIncome).toLocaleString()}). Lenders consider 36%+ high — may limit mortgage qualification or refinancing.`,
            tool_for_details: 'calculate_net_worth',
          })
        } else if (dti !== null && dti > 0.28) {
          findings.push({
            priority: 'medium',
            action: `Debt-to-income ratio is ${(dti * 100).toFixed(0)}% — monitor`,
            detail: 'Above the 28% conventional mortgage guideline. Paying down debt improves refinancing eligibility and financial flexibility.',
            tool_for_details: 'calculate_net_worth',
          })
        }

        findings.push({
          priority: 'low',
          action: 'Review full net worth picture',
          detail: `Net worth snapshot: $${Math.round(netWorth).toLocaleString()} ($${Math.round(totalAssets).toLocaleString()} assets − $${Math.round(totalLiabilities).toLocaleString()} liabilities). Run calculate_net_worth for liquid/illiquid breakdown.`,
          tool_for_details: 'calculate_net_worth',
        })
      } else {
        findings.push({
          priority: 'low',
          action: 'Add liabilities to profile for net worth and debt analysis',
          detail: 'No liabilities found — if you have a mortgage, student loans, or other debt, add them to unlock DTI analysis, net worth calculation, and debt payoff vs invest modeling.',
          tool_for_details: 'calculate_net_worth',
        })
      }

      // Planned state move flag
      const plannedMoves = (profile as any).planned_moves ?? []
      if (plannedMoves.length > 0) {
        const move = plannedMoves[0]
        const highTaxDest = ['CA', 'NY', 'NJ', 'OR', 'MN'].includes((move.to_state ?? '').toUpperCase())
        if (highTaxDest) {
          findings.push({
            priority: 'high',
            action: `Plan equity vesting around ${move.from_state}→${move.to_state} move (high tax impact)`,
            detail: `Planned move to ${move.to_state} (high income tax state). RSU vesting and option exercises after establishing ${move.to_state} domicile will be subject to ${move.to_state} income tax. Accelerating vesting events before the move may save significantly.`,
            tool_for_details: 'plan_state_residency_timing',
          })
        }
      }

      categories.push({
        category: 'Net Worth & Debt',
        score: findings.some(f => f.priority === 'critical' || f.priority === 'high') ? 'needs_attention' : 'good',
        findings,
      })
    }

    // -----------------------------------------------------------------------
    // 7. SPECIALIZED PLANNING (Phase 3)
    // -----------------------------------------------------------------------
    {
      const findings: Finding[] = []

      // Foreign accounts / FBAR
      const foreignAccounts = (profile as any).foreign_accounts ?? []
      const hasNreNro = foreignAccounts.length > 0
      // Even without profile data, flag if user appears to be an NRI (check name/context)
      if (hasNreNro) {
        const aggregateUsd = foreignAccounts.reduce((s: number, a: any) => s + (a.balance_usd ?? 0), 0)
        if (aggregateUsd > 10_000) {
          findings.push({
            priority: 'critical',
            action: `File FBAR (FinCEN 114) — foreign account balance $${Math.round(aggregateUsd).toLocaleString()} exceeds $10,000 threshold`,
            detail: 'Aggregate foreign account balance exceeds the $10,000 FBAR filing threshold. Failure to file can result in $10,000+ penalties per violation.',
            tool_for_details: 'plan_foreign_accounts',
          })
        }
        findings.push({
          priority: 'medium',
          action: 'Review NRE/NRO interest reporting — NRE interest is US-taxable despite India exemption',
          detail: 'NRE account interest is often overlooked on US returns. NRO interest qualifies for foreign tax credit to offset Indian TDS. Run plan_foreign_accounts for full analysis.',
          tool_for_details: 'plan_foreign_accounts',
        })
      } else {
        // Nudge — user likely has Indian accounts based on roadmap context
        findings.push({
          priority: 'low',
          action: 'Add foreign account data (NRE/NRO) to profile for FBAR/FATCA analysis',
          detail: 'If you hold NRE or NRO accounts in India, FBAR filing is required if aggregate balance > $10,000 at any point during the year. Use plan_foreign_accounts for full obligations analysis.',
          tool_for_details: 'plan_foreign_accounts',
        })
      }

      // State residency timing (check planned_moves)
      const plannedMoves = (profile as any).planned_moves ?? []
      if (plannedMoves.length > 0) {
        const highTaxDest = plannedMoves.find((m: any) => ['CA', 'NY', 'NJ', 'OR', 'MN'].includes((m.to_state ?? '').toUpperCase()))
        if (highTaxDest) {
          findings.push({
            priority: 'high',
            action: `Time RSU/option vesting before ${highTaxDest.from_state}→${highTaxDest.to_state} move`,
            detail: `Equity events vesting after CA domicile is established are subject to CA's up to 13.3% income tax. CA source-income rules also apply partial-year proration. Accelerate or defer vesting events strategically.`,
            tool_for_details: 'plan_state_residency_timing',
          })
        }
      }

      // Gift/inheritance planning
      findings.push({
        priority: 'medium',
        action: 'Plan asset transfers from parents using annual gift exclusions and inheritance step-up',
        detail: `Each parent can gift $${ANNUAL_GIFT_EXCLUSION.toLocaleString()}/yr per recipient ($${(ANNUAL_GIFT_EXCLUSION * 2).toLocaleString()} for both parents) without using lifetime exemption. Highly appreciated assets are better inherited (stepped-up basis) than gifted. TCJA lifetime exemption ($${LIFETIME_ESTATE_EXEMPTION.toLocaleString()}) sunsets after 2025.`,
        tool_for_details: 'plan_gift_and_inheritance',
      })

      // Insurance needs
      const totalIncome = profile.income?.reduce((s,i) => s + i.annual_amount, 0) ?? 0
      const hasDependents = (profile.dependents?.length ?? 0) > 0
      if (hasDependents && totalIncome > 0) {
        findings.push({
          priority: 'high',
          action: 'Verify life insurance coverage is adequate for dependents',
          detail: `Rule of thumb: 10x income ($${Math.round(totalIncome * 10).toLocaleString()}) in life insurance while dependents are in the picture. Also check disability insurance (65% income replacement) and umbrella policy.`,
          tool_for_details: 'analyze_insurance_needs',
        })
      } else {
        findings.push({
          priority: 'medium',
          action: 'Review disability insurance and umbrella policy coverage',
          detail: 'Disability insurance (65% of income) protects your earning ability. Umbrella policy protects accumulated net worth. Run analyze_insurance_needs for a full gap analysis.',
          tool_for_details: 'analyze_insurance_needs',
        })
      }

      // Estate basics
      if (hasDependents) {
        findings.push({
          priority: 'critical',
          action: 'Complete estate planning basics — will, guardian designation, beneficiary audit',
          detail: 'With minor dependents, a will with guardian designation and current beneficiary designations on all accounts are essential. Retirement account beneficiaries override wills — check each account.',
          tool_for_details: 'plan_estate_basics',
        })
      } else {
        findings.push({
          priority: 'medium',
          action: 'Audit beneficiary designations, healthcare directive, and power of attorney',
          detail: 'Estate basics — beneficiary designations on retirement accounts, healthcare directive, and durable POA — protect you and your estate at minimal cost. Run plan_estate_basics for a full checklist.',
          tool_for_details: 'plan_estate_basics',
        })
      }

      categories.push({
        category: 'Specialized Planning',
        score: findings.some(f => f.priority === 'critical' || f.priority === 'high') ? 'needs_attention' : 'good',
        findings,
      })
    }

    // -----------------------------------------------------------------------
    // 8. PROFILE GAPS
    // -----------------------------------------------------------------------
    {
      const findings: Finding[] = []

      const checks: { condition: boolean; action: string; detail: string }[] = [
        {
          condition: !profile.household?.length,
          action: 'Add household member data (age, retirement age)',
          detail: 'Required for retirement projections, FIRE timeline, and age-based allocation targets.',
        },
        {
          condition: !(profile as any).dependents?.length,
          action: 'Add dependents to profile (children, etc.)',
          detail: 'Required for 529 planning, UTMA accounts, insurance needs analysis, and estate planning.',
        },
        {
          condition: !(profile as any).liabilities?.length,
          action: 'Add liabilities to profile (mortgage, loans)',
          detail: 'Required for net worth calculation, home affordability, and debt payoff vs invest analysis.',
        },
        {
          condition: !(profile as any).stock_options?.length,
          action: 'Add stock option grants to profile (ISO/NSO)',
          detail: 'Required for options exercise planning, AMT exposure analysis, and equity comp strategy.',
        },
        {
          condition: !(profile as any).spending,
          action: 'Add monthly spending data to profile',
          detail: 'Required for savings rate analysis, budget planning, and cash flow forecasting.',
        },
        {
          condition: !(profile as any).planned_moves?.length,
          action: 'Add planned state residency changes to profile',
          detail: 'Required for RSU/options timing around state tax changes (e.g. WA→CA move).',
        },
        {
          condition: !(profile as any).foreign_accounts?.length,
          action: 'Add foreign account data (NRE/NRO)',
          detail: 'Required for FBAR filing threshold check, FATCA obligations, and remittance strategy.',
        },
        {
          condition: !(profile as any).benefits,
          action: 'Add employer benefits data (health plan type, FSA)',
          detail: 'Required for HDHP vs PPO comparison, FSA vs HSA optimization.',
        },
      ]

      for (const check of checks) {
        if (check.condition) {
          findings.push({
            priority: 'low',
            action: check.action,
            detail: check.detail,
          })
        }
      }

      categories.push({
        category: 'Profile Completeness',
        score: findings.length > 3 ? 'needs_attention' : findings.length > 0 ? 'good' : 'good',
        findings,
      })
    }

    // -----------------------------------------------------------------------
    // SYNTHESIS
    // -----------------------------------------------------------------------

    const allFindings = categories.flatMap(c => c.findings.map(f => ({ ...f, category: c.category })))
    const priorityOrder: Priority[] = ['critical', 'high', 'medium', 'low']

    const top_actions = allFindings
      .filter(f => f.priority === 'critical' || f.priority === 'high')
      .sort((a, b) => priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority))
      .slice(0, 7)

    const counts = {
      critical: allFindings.filter(f => f.priority === 'critical').length,
      high:     allFindings.filter(f => f.priority === 'high').length,
      medium:   allFindings.filter(f => f.priority === 'medium').length,
      low:      allFindings.filter(f => f.priority === 'low').length,
    }

    const needsAttention = categories.filter(c => c.score === 'needs_attention').map(c => c.category)

    return {
      categories,
      top_actions,
      counts,
      needs_attention: needsAttention,
      summary: `Financial diagnostic complete. ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium priority items found across ${categories.length} categories.${needsAttention.length ? ` Areas needing immediate attention: ${needsAttention.join(', ')}.` : ' Overall financial health looks good.'} Top priority: ${top_actions[0]?.action ?? 'none'}.`,
    }
  },
})
