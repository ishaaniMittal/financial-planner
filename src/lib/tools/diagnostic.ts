import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { loadProfile } from '../profile'
import { ANNUAL_GIFT_EXCLUSION, LIFETIME_ESTATE_EXEMPTION } from '../tax-data'

// Domain tools — called directly so the diagnostic stays in sync with their logic
import { checkContributionPace, detectIdleCash, calculateSavingsRate } from './cash-flow'
import { checkEmployerMatch, checkRothEligibility, analyzeAssetClassAllocation } from './portfolio-checks'
import { optimizeAssetLocation, calculateTaxDrag, analyzeHoldings, analyzeTaxOpportunities } from './asset-location'
import { projectRetirement, analyzeGoalFunding } from './planning'
import { analyzeFundOverlap } from './fund-analysis'
import { analyzeMegaBackdoorRoth, compareHealthPlans, plan529, calculateNetWorth } from './benefits-equity'
import { analyzeInsuranceNeeds, planEstateBasics, planConcentrationUnwind, planStateResidencyTiming } from './specialized'

type Priority = 'critical' | 'high' | 'medium' | 'low'

interface Finding {
  priority: Priority
  action: string
  detail: string
  estimated_impact?: string
  tool_for_details?: string
}

interface DiagnosticCategory {
  category: string
  score: 'needs_attention' | 'good' | 'not_enough_data'
  findings: Finding[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = { execute?: (...a: any[]) => any }

// Unwrap a Promise.allSettled result — returns any so callers can access fields freely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(r: PromiseSettledResult<any>): any {
  return r.status === 'fulfilled' ? r.value : null
}

// Call a tool's execute function.  All our tools return plain Promises (no streaming),
// so the cast is safe.  Typed as any to avoid fighting the SDK's union return types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function exec(t: AnyTool, args: object = {}): Promise<any> {
  return t.execute!(args)
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
    const categories: DiagnosticCategory[] = []

    // -----------------------------------------------------------------------
    // Run all domain tools in parallel — fast, and each stays in sync with
    // its own tool implementation instead of duplicating logic here.
    // -----------------------------------------------------------------------
    const [
      rContribPace,
      rEmployerMatch,
      rIdleCash,
      rSavingsRate,
      rRothElig,
      rAssetLocation,
      rTaxDrag,
      rTaxOpps,
      rRetirement,
      rGoals,
      rAllocation,
      rHoldings,
      rFundOverlap,
      rNetWorth,
      rMegaBackdoor,
      rHealthPlans,
      r529,
      rInsurance,
      rEstate,
      rConcentration,
      rStateTiming,
    ] = await Promise.allSettled([
      exec(checkContributionPace),
      exec(checkEmployerMatch),
      exec(detectIdleCash),
      exec(calculateSavingsRate),
      exec(checkRothEligibility),
      exec(optimizeAssetLocation),
      exec(calculateTaxDrag),
      exec(analyzeTaxOpportunities),
      exec(projectRetirement, { annual_return_pct }),
      exec(analyzeGoalFunding),
      exec(analyzeAssetClassAllocation),
      exec(analyzeHoldings),
      exec(analyzeFundOverlap),
      exec(calculateNetWorth),
      exec(analyzeMegaBackdoorRoth),
      exec(compareHealthPlans),
      exec(plan529),
      exec(analyzeInsuranceNeeds),
      exec(planEstateBasics),
      exec(planConcentrationUnwind),
      exec(planStateResidencyTiming),
    ])

    // -----------------------------------------------------------------------
    // 1. CASH FLOW & CONTRIBUTIONS
    // -----------------------------------------------------------------------
    {
      const findings: Finding[] = []
      const match  = ok(rEmployerMatch)
      const pace   = ok(rContribPace)
      const cash   = ok(rIdleCash)
      const savings = ok(rSavingsRate)

      if (match && match.total_annual_match_missed > 50) {
        const missedAcct = match.accounts.find((a: any) => !a.capturing_full_match)
        findings.push({
          priority: 'critical',
          action: `Capture full employer match — missing $${match.total_annual_match_missed.toLocaleString()}/yr`,
          detail: missedAcct?.action ?? match.summary,
          estimated_impact: `+$${match.total_annual_match_missed.toLocaleString()}/yr guaranteed return`,
          tool_for_details: 'check_employer_match',
        })
      }

      if (pace && pace.behind.length > 0) {
        const totalRemaining = pace.behind.reduce((s: number, a: any) => s + a.remaining, 0)
        findings.push({
          priority: 'high',
          action: `Increase contributions — ${pace.behind.length} account(s) behind pace`,
          detail: pace.behind.map((a: any) => `${a.name}: needs $${a.monthly_needed.toLocaleString()}/mo`).join(', '),
          estimated_impact: `$${totalRemaining.toLocaleString()} uncaptured tax-advantaged space this year`,
          tool_for_details: 'check_contribution_pace',
        })
      }

      if (cash && cash.idle_cash_detected && cash.excess_cash > 1000) {
        findings.push({
          priority: cash.excess_cash > 10_000 ? 'high' : 'medium',
          action: `Deploy $${cash.excess_cash.toLocaleString()} idle cash beyond emergency fund`,
          detail: cash.summary,
          estimated_impact: `~$${cash.opportunity_cost_annual.toLocaleString()}/yr opportunity cost`,
          tool_for_details: 'detect_idle_cash',
        })
      }

      if (savings) {
        for (const flag of savings.flags) {
          if (flag.includes('spending')) continue  // profile gap, handled below
          findings.push({
            priority: savings.savings_rates.gross_savings_rate_pct !== null && savings.savings_rates.gross_savings_rate_pct < 10 ? 'high' : 'medium',
            action: 'Improve savings rate',
            detail: flag,
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
      const roth    = ok(rRothElig)
      const loc     = ok(rAssetLocation)
      const drag    = ok(rTaxDrag)
      const taxOpps = ok(rTaxOpps)

      if (roth?.excess_contribution_flag) {
        findings.push({
          priority: 'critical',
          action: 'Fix excess Roth IRA contribution — switch to backdoor Roth',
          detail: roth.summary,
          tool_for_details: 'check_roth_eligibility',
        })
      } else if (roth?.backdoor_roth.required || roth?.backdoor_roth.recommended) {
        findings.push({
          priority: roth.backdoor_roth.required ? 'high' : 'medium',
          action: `Switch to backdoor Roth — ${roth.eligibility_status === 'ineligible' ? 'ineligible for direct contribution' : 'in phaseout range'}`,
          detail: roth.summary + (roth.backdoor_roth.pro_rata_note ? ' ' + roth.backdoor_roth.pro_rata_note : ''),
          tool_for_details: 'check_roth_eligibility',
        })
      }

      if (loc?.optimization_needed && loc.misplacements.length > 0) {
        const highSeverity = loc.misplacements.filter((m: any) => m.severity === 'high').length
        findings.push({
          priority: highSeverity > 0 ? 'high' : 'medium',
          action: `Reposition ${loc.misplacements.length} misplaced holding(s) for better tax efficiency`,
          detail: loc.summary,
          estimated_impact: drag ? `~$${drag.total_annual_drag.toLocaleString()}/yr in avoidable tax drag` : undefined,
          tool_for_details: 'optimize_asset_location',
        })
      }

      if (taxOpps?.opportunities_found) {
        const tlh = (taxOpps.tax_loss_candidates ?? []).length
        if (tlh > 0) {
          findings.push({
            priority: 'medium',
            action: `Harvest tax losses — ${tlh} candidate(s) in taxable accounts`,
            detail: taxOpps.summary,
            tool_for_details: 'analyze_tax_opportunities',
          })
        }
        if ((taxOpps.large_taxable_gains ?? []).length > 0) {
          findings.push({
            priority: 'medium',
            action: 'Plan around large taxable gains — consider lot selection and timing',
            detail: taxOpps.summary,
            tool_for_details: 'analyze_tax_opportunities',
          })
        }
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
      const ret  = ok(rRetirement)
      const goals = ok(rGoals)

      if (ret?.goal) {
        if (!ret.goal.on_track && ret.goal.gap_at_target_date) {
          findings.push({
            priority: 'high',
            action: `Increase savings — off track for ${ret.goal.name}`,
            detail: ret.summary,
            estimated_impact: ret.goal.shortfall_per_year ? `Need $${ret.goal.shortfall_per_year.toLocaleString()}/yr more` : undefined,
            tool_for_details: 'project_retirement',
          })
        } else {
          findings.push({
            priority: 'low',
            action: `${ret.goal.name} is on track`,
            detail: ret.summary,
            tool_for_details: 'project_retirement',
          })
        }
      } else if (ret) {
        findings.push({
          priority: 'low',
          action: 'Review retirement timeline',
          detail: ret.summary,
          tool_for_details: 'project_retirement',
        })
      }

      if (goals) {
        const offTrack = (goals.goals ?? []).filter((g: any) => !g.on_track)
        for (const g of offTrack) {
          findings.push({
            priority: g.years_remaining < 2 ? 'high' : 'medium',
            action: `Increase funding for goal: ${g.name}`,
            detail: `Projected $${Math.round(g.projected_value).toLocaleString()} vs $${g.target_amount.toLocaleString()} target. Gap: $${Math.round(g.gap ?? 0).toLocaleString()}.`,
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
      const alloc    = ok(rAllocation)
      const holdings = ok(rHoldings)
      const funds    = ok(rFundOverlap)
      const conc     = ok(rConcentration)

      if (alloc?.rebalancing_needed) {
        const significant = (alloc.drift_analysis ?? []).filter((d: any) => d.severity === 'significant' || d.severity === 'moderate')
        findings.push({
          priority: significant.some((d: any) => d.severity === 'significant') ? 'high' : 'medium',
          action: 'Rebalance portfolio — allocation has drifted from target',
          detail: alloc.summary,
          tool_for_details: 'analyze_asset_class_allocation',
        })
      }

      if (holdings && (holdings.concentration_risks ?? []).length > 0) {
        for (const risk of holdings.concentration_risks as any[]) {
          findings.push({
            priority: risk.concentration_pct > 30 ? 'high' : 'medium',
            action: `Reduce concentration in ${risk.ticker} (${risk.concentration_pct?.toFixed(0)}% of portfolio)`,
            detail: `$${Math.round(risk.market_value ?? 0).toLocaleString()} in ${risk.ticker}. Single-stock risk is significant.`,
            tool_for_details: 'plan_concentration_unwind',
          })
        }
      }

      if (conc && (conc.concentrated_positions ?? []).length > 0) {
        const pos = conc.concentrated_positions[0] as any
        if (pos && !(holdings?.concentration_risks ?? []).find((r: any) => r.ticker === pos.ticker)) {
          findings.push({
            priority: 'medium',
            action: `Unwind concentrated position: ${pos.ticker} (${pos.current_concentration_pct}% of portfolio)`,
            detail: conc.recommended_priority ?? pos.ticker,
            tool_for_details: 'plan_concentration_unwind',
          })
        }
      }

      if (funds) {
        const highEr = (funds.substitution_opportunities ?? []).filter((s: any) => s.current_er > 0.5)
        if (highEr.length > 0) {
          findings.push({
            priority: 'medium',
            action: `Switch ${highEr.length} high-fee fund(s) to cheaper alternatives`,
            detail: `Total annual fees: $${Math.round(funds.total_annual_fees ?? 0).toLocaleString()}. ${highEr.map((s: any) => `${s.ticker}: ${s.current_er}% → ${s.suggested_er}%`).join(', ')}.`,
            estimated_impact: `~$${Math.round(highEr.reduce((s: number, f: any) => s + (f.annual_savings ?? 0), 0)).toLocaleString()}/yr saved`,
            tool_for_details: 'analyze_fund_overlap',
          })
        }
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
      const mbd     = ok(rMegaBackdoor)
      const hp      = ok(rHealthPlans)
      const plan529r = ok(r529)

      // Mega backdoor Roth
      if (mbd?.eligible && (mbd.after_tax_capacity_remaining ?? 0) > 1000) {
        findings.push({
          priority: 'high',
          action: `Use Mega Backdoor Roth — $${mbd.after_tax_capacity_remaining.toLocaleString()} of capacity unused`,
          detail: mbd.summary,
          estimated_impact: `Up to $${mbd.after_tax_capacity_remaining.toLocaleString()}/yr additional Roth space`,
          tool_for_details: 'analyze_mega_backdoor_roth',
        })
      } else if ((profile.benefits as any)?.has_mega_backdoor_roth === undefined) {
        findings.push({
          priority: 'low',
          action: 'Confirm whether 401(k) plan supports Mega Backdoor Roth',
          detail: 'Ask HR if after-tax (non-Roth) contributions and in-plan Roth conversion are available. Can unlock up to ~$46,500/yr extra Roth space.',
          tool_for_details: 'analyze_mega_backdoor_roth',
        })
      }

      // HSA / health plan
      const hsaAcct = profile.accounts.find(a => a.name.toLowerCase().includes('hsa'))
      if (hsaAcct && hsaAcct.annual_contribution_limit) {
        const remaining = hsaAcct.annual_contribution_limit - hsaAcct.ytd_contribution
        if (remaining > 0) {
          findings.push({
            priority: 'medium',
            action: `Max HSA — $${remaining.toLocaleString()} remaining (triple tax-advantaged)`,
            detail: 'HSA: deductible contributions, tax-free growth, tax-free medical withdrawals.',
            tool_for_details: 'get_contribution_limits',
          })
        }
      } else if (hp && hp.current_plan !== 'HDHP' && !hsaAcct) {
        findings.push({
          priority: 'medium',
          action: `Evaluate HDHP + HSA — currently on ${hp.current_plan ?? 'unknown plan'}`,
          detail: hp.recommendation ?? 'Run compare_health_plans for a break-even analysis.',
          tool_for_details: 'compare_health_plans',
        })
      }

      // RSU withholding check (needs live data — flag based on income type)
      const rsuIncome = profile.income?.filter(i => i.source === 'rsu').reduce((s, i) => s + i.annual_amount, 0) ?? 0
      if (rsuIncome > 0) {
        const withholding22 = rsuIncome * 0.22
        const marginalRate = profile.tax.marginal_federal_rate + profile.tax.marginal_state_rate
        const estimatedShortfall = rsuIncome * (marginalRate - 0.22)
        if (estimatedShortfall > 1000) {
          findings.push({
            priority: 'high',
            action: 'Make estimated tax payments for RSU withholding shortfall',
            detail: `RSUs withheld at 22% flat but combined marginal rate is ~${(marginalRate * 100).toFixed(0)}%. Estimated shortfall: ~$${Math.round(estimatedShortfall).toLocaleString()}/yr. Use plan_rsu_taxes with current vest price for exact calculation.`,
            estimated_impact: `~$${Math.round(estimatedShortfall).toLocaleString()} tax due beyond withholding`,
            tool_for_details: 'plan_rsu_taxes',
          })
        }
      }

      // Stock options check
      const stockOptions = profile.stock_options ?? []
      if (stockOptions.length > 0) {
        const now = new Date()
        const soonExpiring = stockOptions.filter(g => {
          if (!g.expiration_date) return false
          const ms = new Date(g.expiration_date).getTime() - now.getTime()
          return ms > 0 && ms < 365 * 86400000
        })
        if (soonExpiring.length > 0) {
          findings.push({
            priority: 'critical',
            action: `${soonExpiring.length} option grant(s) expiring within 12 months — review exercise plan`,
            detail: `Grant(s) ${soonExpiring.map(g => g.grant_id).join(', ')} expire soon. Use plan_stock_options with current price for AMT analysis.`,
            tool_for_details: 'plan_stock_options',
          })
        } else if (stockOptions.some(g => g.vested_shares > 0)) {
          findings.push({
            priority: 'medium',
            action: 'Review ISO exercise strategy for AMT exposure',
            detail: `${stockOptions.filter(g => g.type === 'ISO').length} ISO grant(s) with ${stockOptions.reduce((s, g) => s + g.vested_shares, 0).toLocaleString()} total vested shares. Use plan_stock_options with current price.`,
            tool_for_details: 'plan_stock_options',
          })
        }
      }

      // 529
      const children = profile.dependents?.filter(d => d.relationship === 'child') ?? []
      if (children.length > 0 && plan529r) {
        if (!plan529r.projection.on_track && (plan529r.projection.funding_gap ?? 0) > 0) {
          findings.push({
            priority: 'medium',
            action: `529 underfunded — increase contributions for ${plan529r.beneficiary}`,
            detail: plan529r.summary,
            estimated_impact: `Need $${plan529r.required_monthly_to_fully_fund.toLocaleString()}/mo to fully fund`,
            tool_for_details: 'plan_529',
          })
        } else if (!profile.accounts.find(a => a.name.toLowerCase().includes('529'))) {
          findings.push({
            priority: 'high',
            action: `Open 529 for ${children.map(c => c.name).join(', ')}`,
            detail: 'No 529 account found. Tax-free growth for education — the earlier you start, the more compounding.',
            tool_for_details: 'plan_529',
          })
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
      const nw = ok(rNetWorth)

      if (nw) {
        const dti = nw.debt_metrics.debt_to_income_ratio_pct
        if (dti !== null && dti > 36) {
          findings.push({
            priority: 'high',
            action: `Reduce debt-to-income ratio (currently ${dti.toFixed(0)}%)`,
            detail: nw.summary,
            tool_for_details: 'calculate_net_worth',
          })
        } else if (dti !== null && dti > 28) {
          findings.push({
            priority: 'medium',
            action: `Debt-to-income ratio is ${dti.toFixed(0)}% — monitor`,
            detail: 'Above the 28% conventional mortgage guideline. Paying down debt improves refinancing eligibility.',
            tool_for_details: 'calculate_net_worth',
          })
        }

        const highInterest = (nw.liabilities.breakdown ?? []).filter((l: any) => l.interest_rate > 7 && l.type !== 'mortgage')
        if (highInterest.length > 0) {
          const total = highInterest.reduce((s: number, l: any) => s + l.balance, 0)
          findings.push({
            priority: 'high',
            action: `Pay down ${highInterest.length} high-interest debt(s) before investing`,
            detail: `${highInterest.map((l: any) => `${l.name} (${l.interest_rate}%)`).join(', ')} — $${Math.round(total).toLocaleString()} total.`,
            tool_for_details: 'calculate_net_worth',
          })
        }

        findings.push({
          priority: 'low',
          action: 'Review net worth snapshot',
          detail: nw.summary,
          tool_for_details: 'calculate_net_worth',
        })
      }

      // State move timing
      const plannedMoves = profile.planned_moves ?? []
      if (plannedMoves.length > 0) {
        const move = plannedMoves[0]
        const highTax = ['CA', 'NY', 'NJ', 'OR', 'MN'].includes((move.to_state ?? '').toUpperCase())
        if (highTax) {
          const timing = ok(rStateTiming)
          const savings = timing?.summary_of_events?.potential_state_tax_savings_from_accelerating ?? 0
          findings.push({
            priority: 'high',
            action: `Time equity vesting before ${move.from_state}→${move.to_state} move`,
            detail: savings > 0
              ? `Vesting before the move could save ~$${Math.round(savings).toLocaleString()} in ${move.to_state} state income tax.`
              : `Moving to ${move.to_state} (high income tax). Add upcoming vesting events to plan_state_residency_timing for savings estimate.`,
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
    // 7. SPECIALIZED PLANNING
    // -----------------------------------------------------------------------
    {
      const findings: Finding[] = []
      const ins    = ok(rInsurance)
      const estate = ok(rEstate)

      // Insurance
      if (ins) {
        const hasDependents = (profile.dependents?.length ?? 0) > 0
        if (ins.life_insurance.status === 'underinsured' && hasDependents) {
          findings.push({
            priority: 'high',
            action: `Life insurance gap: $${(ins.life_insurance.coverage_gap ?? 0).toLocaleString()} — dependents unprotected`,
            detail: ins.life_insurance.recommendation,
            tool_for_details: 'analyze_insurance_needs',
          })
        }
        if (ins.disability_insurance.status === 'underinsured') {
          findings.push({
            priority: 'high',
            action: `Disability insurance gap: $${(ins.disability_insurance.monthly_gap ?? 0).toLocaleString()}/mo`,
            detail: ins.disability_insurance.recommendation,
            tool_for_details: 'analyze_insurance_needs',
          })
        }
        if (ins.umbrella_insurance.status === 'insufficient') {
          findings.push({
            priority: 'medium',
            action: `Umbrella policy gap: $${(ins.umbrella_insurance.gap ?? 0).toLocaleString()} limit`,
            detail: ins.umbrella_insurance.recommendation,
            tool_for_details: 'analyze_insurance_needs',
          })
        }
      }

      // Estate basics
      if (estate) {
        if (estate.readiness_score === 'critical_gaps') {
          findings.push({
            priority: 'critical',
            action: `Estate planning: ${estate.critical_items_missing} critical item(s) missing`,
            detail: (estate.immediate_actions as string[]).slice(0, 2).join(' | '),
            tool_for_details: 'plan_estate_basics',
          })
        } else if (estate.readiness_score === 'needs_attention') {
          findings.push({
            priority: 'high',
            action: 'Complete estate planning basics',
            detail: (estate.immediate_actions as string[]).slice(0, 2).join(' | '),
            tool_for_details: 'plan_estate_basics',
          })
        }
        if ((estate.beneficiary_audit as any).retirement_accounts_missing > 0) {
          findings.push({
            priority: 'critical',
            action: `Add beneficiaries to ${(estate.beneficiary_audit as any).retirement_accounts_missing} retirement account(s)`,
            detail: (estate.beneficiary_audit as any).priority_action,
            tool_for_details: 'plan_estate_basics',
          })
        }
      }

      // Gift/inheritance planning nudge
      findings.push({
        priority: 'medium',
        action: 'Plan parental asset transfers using annual gift exclusions',
        detail: `Each parent can give $${ANNUAL_GIFT_EXCLUSION.toLocaleString()}/yr/recipient tax-free. Highly appreciated assets are better inherited (stepped-up basis) than gifted. TCJA exemption ($${LIFETIME_ESTATE_EXEMPTION.toLocaleString()}) sunsets after 2025.`,
        tool_for_details: 'plan_gift_and_inheritance',
      })

      // Foreign accounts nudge
      findings.push({
        priority: 'low',
        action: 'Review NRE/NRO account obligations (FBAR, FATCA, NRE interest)',
        detail: 'If foreign accounts exceed $10,000 aggregate at any point, FBAR (FinCEN 114) filing is required. NRE interest is US-taxable despite India exemption.',
        tool_for_details: 'plan_foreign_accounts',
      })

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
      const checks = [
        { condition: !profile.household?.length,         action: 'Add household member data', detail: 'Required for retirement projections and age-based allocation.' },
        { condition: !profile.dependents?.length,        action: 'Add dependents to profile', detail: 'Required for 529, insurance, estate planning.' },
        { condition: !profile.liabilities?.length,       action: 'Add liabilities (mortgage, loans)', detail: 'Required for net worth, DTI, and debt payoff analysis.' },
        { condition: !profile.stock_options?.length,     action: 'Add stock option grants (ISO/NSO)', detail: 'Required for options exercise planning and AMT analysis.' },
        { condition: !profile.spending?.length,          action: 'Add monthly spending data', detail: 'Required for savings rate and cash flow analysis.' },
        { condition: !profile.planned_moves?.length,     action: 'Add planned state residency changes', detail: 'Required for RSU/options timing around state tax changes.' },
        { condition: !profile.benefits,                  action: 'Add employer benefits data', detail: 'Required for HDHP vs PPO and FSA/HSA optimization.' },
      ]
      for (const c of checks) {
        if (c.condition) findings.push({ priority: 'low', action: c.action, detail: c.detail })
      }

      categories.push({
        category: 'Profile Completeness',
        score: findings.length > 3 ? 'needs_attention' : 'good',
        findings,
      })
    }

    // -----------------------------------------------------------------------
    // SYNTHESIS
    // -----------------------------------------------------------------------
    const priorityOrder: Priority[] = ['critical', 'high', 'medium', 'low']
    const allFindings = categories.flatMap(c => c.findings.map(f => ({ ...f, category: c.category })))

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
      summary: `Financial diagnostic complete. ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium priority items across ${categories.length} categories.${needsAttention.length ? ` Areas needing attention: ${needsAttention.join(', ')}.` : ' Overall health looks good.'} Top priority: ${top_actions[0]?.action ?? 'none'}.`,
    }
  },
})
