import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { loadProfile } from '../profile'
import {
  getBrackets, federalTaxOwed, federalMarginalRate,
  roomInCurrentBracket, niitApplies, NIIT_RATE, TAX_YEAR,
} from '../tax-data'

// ---------------------------------------------------------------------------
// plan_rsu_taxes
// ---------------------------------------------------------------------------

export const planRsuTaxes = tool({
  description: `Analyze RSU tax implications: income recognized at vest, withholding shortfall at supplemental
rate vs actual marginal rate, net tax due, and sell-to-cover vs hold strategy.
Also models the tax impact of selling vested shares immediately vs holding for long-term capital gains.`,
  inputSchema: zodSchema(z.object({
    shares_vesting: z.number().describe('Number of RSU shares vesting.'),
    price_at_vest: z.number().describe('Fair market value per share at vest date (this becomes cost basis).'),
    current_price: z.number().optional().describe('Current share price if different from vest price (for sell-now analysis).'),
    vest_date: z.string().optional().describe('ISO date of vest (e.g. "2025-03-15"). Used to determine short/long-term on subsequent sale.'),
    withholding_pct: z.number().optional().describe('Supplemental withholding rate used by employer. Defaults to 22 (federal flat supplemental rate).'),
  })),
  execute: async ({ shares_vesting, price_at_vest, current_price, vest_date, withholding_pct = 22 }) => {
    const profile = loadProfile()
    const filingStatus = profile.tax.filing_status

    const rsuIncome = shares_vesting * price_at_vest
    const baseAgi = profile.tax.estimated_agi
    const newAgi = baseAgi + rsuIncome

    // Tax on base income vs new income
    const marginalOnRsu = federalTaxOwed(newAgi, filingStatus) - federalTaxOwed(baseAgi, filingStatus)
    const effectiveRateOnRsu = rsuIncome > 0 ? marginalOnRsu / rsuIncome : 0

    // Withholding
    const withheld = rsuIncome * (withholding_pct / 100)
    const withholdingShortfall = Math.max(0, marginalOnRsu - withheld)
    const withholdingExcess = Math.max(0, withheld - marginalOnRsu)

    // State tax
    const stateRateOnRsu = profile.tax.marginal_state_rate
    const stateTaxOnRsu = rsuIncome * stateRateOnRsu
    const totalTaxOnRsu = marginalOnRsu + stateTaxOnRsu
    const totalEffectiveRateOnRsu = rsuIncome > 0 ? totalTaxOnRsu / rsuIncome : 0

    // Sell-now vs hold analysis
    const sellPrice = current_price ?? price_at_vest
    const gainIfSellNow = (sellPrice - price_at_vest) * shares_vesting
    const isLongTerm = vest_date
      ? (new Date().getTime() - new Date(vest_date).getTime()) / 86400000 > 365
      : null

    const gainTaxIfSellNow = gainIfSellNow > 0
      ? gainIfSellNow * (isLongTerm === true
          ? profile.tax.long_term_cap_gains_rate
          : federalMarginalRate(newAgi, filingStatus) + stateRateOnRsu)
      : gainIfSellNow * (federalMarginalRate(newAgi, filingStatus) + stateRateOnRsu)

    // Sell-to-cover: shares sold to cover tax
    const sharesToCoverTax = Math.ceil(totalTaxOnRsu / sellPrice)
    const sharesKeptAfterCover = shares_vesting - sharesToCoverTax

    // NIIT
    const niitFlag = niitApplies(newAgi, filingStatus)
    const niitOnRsu = niitFlag ? rsuIncome * NIIT_RATE : 0

    return {
      rsu_income_at_vest: Math.round(rsuIncome),
      shares_vesting,
      price_at_vest,
      base_agi: baseAgi,
      new_agi_with_rsu: Math.round(newAgi),
      federal_tax_on_rsu: Math.round(marginalOnRsu),
      state_tax_on_rsu: Math.round(stateTaxOnRsu),
      niit_on_rsu: Math.round(niitOnRsu),
      total_tax_on_rsu: Math.round(totalTaxOnRsu + niitOnRsu),
      effective_rate_on_rsu_pct: parseFloat((totalEffectiveRateOnRsu * 100 + (niitFlag ? 3.8 : 0)).toFixed(1)),
      withholding: {
        rate_pct: withholding_pct,
        amount_withheld: Math.round(withheld),
        shortfall: Math.round(withholdingShortfall),
        excess: Math.round(withholdingExcess),
        action: withholdingShortfall > 500
          ? `Make an estimated tax payment of ~$${Math.round(withholdingShortfall).toLocaleString()} to avoid underpayment penalty. Due dates: Apr 15, Jun 15, Sep 15, Jan 15.`
          : withholdingExcess > 0
            ? `Employer is over-withholding by $${Math.round(withholdingExcess).toLocaleString()}. You'll receive this as a refund.`
            : 'Withholding is close to actual tax owed.',
      },
      sell_vs_hold: {
        current_price: sellPrice,
        gain_loss_if_sell_now: Math.round(gainIfSellNow),
        holding_period_known: isLongTerm !== null,
        is_long_term: isLongTerm,
        gain_tax_if_sell_now: Math.round(gainTaxIfSellNow),
        recommendation: gainIfSellNow > 0 && isLongTerm === false
          ? `Shares have a $${Math.round(gainIfSellNow).toLocaleString()} short-term gain. Holding past ${vest_date ? new Date(new Date(vest_date).getTime() + 366 * 86400000).toLocaleDateString() : '1 year from vest'} converts it to long-term capital gains — saving ~${((federalMarginalRate(newAgi, filingStatus) - profile.tax.long_term_cap_gains_rate) * 100).toFixed(0)}pp in tax rate.`
          : gainIfSellNow <= 0
            ? 'Shares are at or below vest price. No gain to defer — holding has no tax benefit vs selling now.'
            : `Shares have a long-term gain of $${Math.round(gainIfSellNow).toLocaleString()}. Factor in concentration risk vs tax cost of selling.`,
      },
      sell_to_cover: {
        shares_to_sell: sharesToCoverTax,
        shares_kept: sharesKeptAfterCover,
        proceeds_from_cover: Math.round(sharesToCoverTax * sellPrice),
      },
      bracket_impact: {
        marginal_rate_before: federalMarginalRate(baseAgi, filingStatus),
        marginal_rate_after: federalMarginalRate(newAgi, filingStatus),
        bracket_jumped: federalMarginalRate(newAgi, filingStatus) > federalMarginalRate(baseAgi, filingStatus),
      },
      summary: `${shares_vesting} RSUs at $${price_at_vest}/share = $${Math.round(rsuIncome).toLocaleString()} ordinary income. Total tax: ~$${Math.round(totalTaxOnRsu + niitOnRsu).toLocaleString()} (${(totalEffectiveRateOnRsu * 100 + (niitFlag ? 3.8 : 0)).toFixed(0)}% effective). Withholding ${withholdingShortfall > 0 ? `short by $${Math.round(withholdingShortfall).toLocaleString()}` : 'adequate'}.`,
    }
  },
})

// ---------------------------------------------------------------------------
// plan_roth_conversion
// ---------------------------------------------------------------------------

export const planRothConversion = tool({
  description: `Model a Roth conversion strategy: how much to convert from Traditional IRA/401k to Roth
each year to fill a tax bracket without crossing into the next one. Shows the multi-year tax
savings vs paying taxes in retirement, and the break-even horizon.`,
  inputSchema: zodSchema(z.object({
    years_to_model: z.number().optional().describe('Number of years to model conversions. Defaults to years until retirement.'),
    target_bracket_ceiling: z.number().optional().describe('Convert up to this income level (top of the bracket you want to fill). E.g. 103350 fills up to the 22% bracket. Defaults to top of current bracket.'),
    expected_retirement_income: z.number().optional().describe('Expected annual taxable income in retirement (pension, Social Security, RMDs). Used to estimate retirement tax rate.'),
    portfolio_return_pct: z.number().optional().describe('Expected annual portfolio return % for projecting tax-deferred growth. Defaults to 7.0.'),
  })),
  execute: async ({ years_to_model, target_bracket_ceiling, expected_retirement_income, portfolio_return_pct = 7.0 }) => {
    const profile = loadProfile()
    const filingStatus = profile.tax.filing_status

    const currentAgi = profile.tax.estimated_agi
    const stateRate = profile.tax.marginal_state_rate

    const primaryMember = profile.household?.find(h => h.is_primary)
    const yearsToRetirement = primaryMember
      ? Math.max(0, primaryMember.retirement_age - primaryMember.age)
      : 20
    const modelYears = years_to_model ?? Math.min(yearsToRetirement, 20)

    // Tax-deferred balance available for conversion
    const taxDeferredAccounts = profile.accounts.filter(a => a.tax_treatment === 'tax_deferred')
    const taxDeferredBalance = taxDeferredAccounts.reduce((s, a) => s + a.balance, 0)
    const taxDeferredNames = taxDeferredAccounts.map(a => a.name)

    // Current bracket ceiling — how much room before next bracket
    const currentMarginalRate = federalMarginalRate(currentAgi, filingStatus)
    const roomInBracket = roomInCurrentBracket(currentAgi, filingStatus)

    // Find target ceiling: default to top of current bracket
    let conversionCeiling = target_bracket_ceiling ?? 0
    if (!conversionCeiling) {
      for (const [limit] of getBrackets(filingStatus)) {
        if (currentAgi < limit) { conversionCeiling = limit; break }
      }
    }

    const annualConversionAmount = Math.max(0, conversionCeiling - currentAgi)

    // Tax cost per year of converting
    const conversionIncome = annualConversionAmount
    const federalTaxOnConversion = federalTaxOwed(currentAgi + conversionIncome, filingStatus) - federalTaxOwed(currentAgi, filingStatus)
    const stateTaxOnConversion = conversionIncome * stateRate
    const totalTaxPerYear = federalTaxOnConversion + stateTaxOnConversion
    const effectiveRateOnConversion = conversionIncome > 0
      ? parseFloat(((totalTaxPerYear / conversionIncome) * 100).toFixed(1))
      : 0

    // Retirement tax rate estimate (on RMDs + other income)
    const retirementIncome = expected_retirement_income ?? currentAgi * 0.6
    const retirementMarginalRate = federalMarginalRate(retirementIncome, filingStatus)
    const retirementCombinedRate = retirementMarginalRate + stateRate

    // Year-by-year conversion plan
    const yearlyPlan: {
      year: number
      conversion_amount: number
      tax_cost: number
      cumulative_converted: number
      remaining_tax_deferred: number
    }[] = []

    let remaining = taxDeferredBalance
    let cumulativeConverted = 0
    const currentYear = profile.current_year || new Date().getFullYear()

    for (let y = 1; y <= modelYears; y++) {
      // Tax-deferred balance grows each year
      remaining = remaining * (1 + portfolio_return_pct / 100)
      const convertThisYear = Math.min(annualConversionAmount, remaining)
      const taxThisYear = convertThisYear > 0
        ? (federalTaxOwed(currentAgi + convertThisYear, filingStatus) - federalTaxOwed(currentAgi, filingStatus)) + convertThisYear * stateRate
        : 0
      remaining -= convertThisYear
      cumulativeConverted += convertThisYear

      yearlyPlan.push({
        year: currentYear + y,
        conversion_amount: Math.round(convertThisYear),
        tax_cost: Math.round(taxThisYear),
        cumulative_converted: Math.round(cumulativeConverted),
        remaining_tax_deferred: Math.round(remaining),
      })

      if (remaining < 1000) break
    }

    const totalConversionTax = yearlyPlan.reduce((s, y) => s + y.tax_cost, 0)
    const totalConverted = yearlyPlan[yearlyPlan.length - 1]?.cumulative_converted ?? 0

    // Break-even: years of tax-free Roth growth to recoup the conversion tax
    // Tax saved in retirement = totalConverted × (retirementRate - conversionRate)
    const rateDiff = (retirementCombinedRate / 100) - (effectiveRateOnConversion / 100)
    const breakEvenYears = rateDiff > 0 && totalConversionTax > 0
      ? Math.ceil(totalConversionTax / (totalConverted * rateDiff * (portfolio_return_pct / 100)))
      : null

    const conversionMakesSense = retirementCombinedRate > effectiveRateOnConversion

    return {
      tax_deferred_balance: taxDeferredBalance,
      tax_deferred_accounts: taxDeferredNames,
      current_agi: currentAgi,
      current_marginal_rate_pct: parseFloat((currentMarginalRate * 100).toFixed(0)),
      room_in_current_bracket: Math.round(roomInBracket),
      annual_conversion_amount: Math.round(annualConversionAmount),
      conversion_bracket_ceiling: conversionCeiling,
      tax_cost_per_conversion: {
        federal: Math.round(federalTaxOnConversion),
        state: Math.round(stateTaxOnConversion),
        total: Math.round(totalTaxPerYear),
        effective_rate_pct: effectiveRateOnConversion,
      },
      retirement_rate_estimate: {
        expected_retirement_income: Math.round(retirementIncome),
        marginal_rate_pct: parseFloat((retirementMarginalRate * 100).toFixed(0)),
        combined_rate_pct: parseFloat((retirementCombinedRate * 100).toFixed(1)),
      },
      conversion_makes_sense: conversionMakesSense,
      conversion_rationale: conversionMakesSense
        ? `Converting now at ${effectiveRateOnConversion}% is cheaper than paying ${retirementCombinedRate.toFixed(1)}% in retirement — a ${(retirementCombinedRate - effectiveRateOnConversion).toFixed(1)}pp arbitrage.`
        : `Your retirement rate (${retirementCombinedRate.toFixed(1)}%) is not clearly higher than current conversion rate (${effectiveRateOnConversion}%). Conversion may not be beneficial.`,
      yearly_plan: yearlyPlan,
      totals: {
        years_modeled: yearlyPlan.length,
        total_converted: Math.round(totalConverted),
        total_conversion_tax: Math.round(totalConversionTax),
        remaining_tax_deferred: yearlyPlan[yearlyPlan.length - 1]?.remaining_tax_deferred ?? taxDeferredBalance,
        break_even_years: breakEvenYears,
      },
      summary: conversionMakesSense
        ? `Convert $${Math.round(annualConversionAmount).toLocaleString()}/yr (filling to $${conversionCeiling.toLocaleString()} ceiling) at ${effectiveRateOnConversion}% effective rate. Over ${yearlyPlan.length} years: $${Math.round(totalConverted).toLocaleString()} converted, $${Math.round(totalConversionTax).toLocaleString()} in conversion taxes. Saves vs ${retirementCombinedRate.toFixed(1)}% retirement rate.${breakEvenYears ? ` Break-even: ~${breakEvenYears} years of Roth growth.` : ''}`
        : `Roth conversion not clearly beneficial — current rate (${effectiveRateOnConversion}%) is not lower than estimated retirement rate (${retirementCombinedRate.toFixed(1)}%). Revisit if retirement income changes.`,
    }
  },
})
