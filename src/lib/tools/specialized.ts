import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { loadProfile, holdingMarketValue } from '../profile'
import {
  ANNUAL_GIFT_EXCLUSION, LIFETIME_ESTATE_EXEMPTION,
  federalTaxOwed, federalMarginalRate,
  getStateRate, niitApplies, NIIT_RATE,
  TAX_YEAR,
} from '../tax-data'

// ---------------------------------------------------------------------------
// plan_state_residency_timing
// ---------------------------------------------------------------------------

export const planStateResidencyTiming = tool({
  description: `Analyze the tax impact of a state-to-state move (especially WA→CA) on upcoming
RSU vests, stock option exercises, and other income events. Calculates how much income tax
is saved by vesting/exercising before vs after the move. Models CA source-income allocation
for RSUs (time-based proration during vesting period). High-value tool for WA→CA moves given
WA has 0% income tax vs CA's up to 13.3%.`,
  inputSchema: zodSchema(z.object({
    planned_move_date: z.string().optional().describe('ISO date of planned domicile change (e.g. "2025-09-01"). Reads from profile planned_moves if omitted.'),
    from_state: z.string().optional().describe('Two-letter state code of origin. Defaults from profile.'),
    to_state: z.string().optional().describe('Two-letter state code of destination. Defaults from profile.'),
    vesting_events: z.array(z.object({
      label: z.string(),
      vest_date: z.string().describe('ISO date'),
      value: z.number().describe('Gross value of the event in USD'),
      grant_date: z.string().optional().describe('For RSUs/options: grant date for CA source-income proration'),
    })).optional().describe('Upcoming income events to analyze. If omitted, uses profile RSU/option grants (placeholder data).'),
  })),
  execute: async ({ planned_move_date, from_state, to_state, vesting_events }) => {
    const profile = loadProfile()

    // Resolve move details from profile or parameters
    const plannedMove = profile.planned_moves?.find(m =>
      (from_state ? m.from_state === from_state.toUpperCase() : true) &&
      (to_state ? m.to_state === to_state.toUpperCase() : true)
    ) ?? profile.planned_moves?.[0]

    const moveDate = planned_move_date
      ? new Date(planned_move_date)
      : plannedMove ? new Date(plannedMove.planned_date) : null

    const originState = (from_state ?? plannedMove?.from_state ?? profile.tax.state).toUpperCase()
    const destState = (to_state ?? plannedMove?.to_state ?? 'CA').toUpperCase()

    if (!moveDate) {
      return {
        error: 'No move date found. Provide planned_move_date or add a planned_moves entry to your profile.',
        tip: 'Add {"from_state": "WA", "to_state": "CA", "planned_date": "2025-MM-DD", "confirmed": false} to profile.planned_moves.',
      }
    }

    const originRate = getStateRate(originState)
    const destRate = getStateRate(destState)
    const rateDiff = destRate - originRate  // positive means destination is higher tax

    // Events to analyze: user-provided or placeholder from profile income
    const events = vesting_events ?? []

    const today = new Date()
    const moveDateStr = moveDate.toLocaleDateString()

    // Categorize events
    const beforeMove = events.filter(e => new Date(e.vest_date) < moveDate)
    const afterMove = events.filter(e => new Date(e.vest_date) >= moveDate)

    // CA source-income proration for RSUs: CA taxes the fraction of the vesting period
    // spent in CA. If an RSU was granted while in WA and vests after moving to CA,
    // CA claims tax on (days in CA during vesting period / total vesting period days) × value.
    function caSourceIncomeAllocation(event: { vest_date: string; value: number; grant_date?: string }): {
      ca_taxable_pct: number
      ca_taxable_amount: number
      note: string
    } {
      if (destState !== 'CA' || !event.grant_date) {
        return { ca_taxable_pct: 100, ca_taxable_amount: event.value, note: 'Full value taxable in destination state.' }
      }

      const grantDateObj = new Date(event.grant_date)
      const vestDateObj = new Date(event.vest_date)
      const totalVestingDays = Math.max(1, (vestDateObj.getTime() - grantDateObj.getTime()) / 86400000)

      // Days after move date within the vesting period = days in CA during vesting
      const moveIntoVestingPeriod = moveDate! < grantDateObj ? grantDateObj : moveDate!
      const daysInCA = Math.max(0, (vestDateObj.getTime() - moveIntoVestingPeriod.getTime()) / 86400000)
      const caPct = Math.min(1, daysInCA / totalVestingDays)
      const caTaxableAmount = event.value * caPct

      return {
        ca_taxable_pct: parseFloat((caPct * 100).toFixed(1)),
        ca_taxable_amount: Math.round(caTaxableAmount),
        note: `Grant ${event.grant_date} → vest ${event.vest_date}. CA claims ${(caPct * 100).toFixed(0)}% (${Math.round(daysInCA)}/${Math.round(totalVestingDays)} days in CA during vesting period).`,
      }
    }

    const analyzedAfterMove = afterMove.map(e => {
      const allocation = caSourceIncomeAllocation(e)
      const taxInOrigin = e.value * originRate
      const taxInDest = allocation.ca_taxable_amount * destRate
      return {
        ...e,
        vest_date_readable: new Date(e.vest_date).toLocaleDateString(),
        timing: 'after_move',
        state_tax_if_vested_before_move: Math.round(e.value * originRate),
        state_tax_after_move: Math.round(taxInDest),
        state_tax_savings_from_moving_before: Math.round(taxInDest - e.value * originRate),
        ca_source_income: allocation,
      }
    })

    const analyzedBeforeMove = beforeMove.map(e => ({
      ...e,
      vest_date_readable: new Date(e.vest_date).toLocaleDateString(),
      timing: 'before_move',
      state_tax: Math.round(e.value * originRate),
      note: `Vests in ${originState} — ${(originRate * 100).toFixed(1)}% state rate applies.`,
    }))

    // Tax if all events vest in origin vs destination
    const totalValueAllEvents = events.reduce((s, e) => s + e.value, 0)
    const taxIfAllInOrigin = totalValueAllEvents * originRate
    const taxIfAllInDest = totalValueAllEvents * destRate
    const maxTaxSavingsByTiming = taxIfAllInDest - taxIfAllInOrigin

    // Events already before the move: these are safe (origin-state taxed)
    const valueBeforeMove = beforeMove.reduce((s, e) => s + e.value, 0)
    const valueAfterMove = afterMove.reduce((s, e) => s + e.value, 0)
    const taxOnAfterMoveInDest = analyzedAfterMove.reduce((s, e) => s + e.state_tax_after_move, 0)
    const taxOnAfterMoveIfInOrigin = valueAfterMove * originRate
    const taxSavingsIfAccelerate = taxOnAfterMoveInDest - taxOnAfterMoveIfInOrigin

    // Domicile establishment factors
    const domicileFactors = [
      'Update driver\'s license to new state within 60 days of move',
      'Register to vote in new state',
      'Change primary home address on all financial accounts',
      'File a final part-year return in origin state and a part-year return in destination state',
      'If moving to CA: log your first night in CA — this is your CA residency start date',
      'Keep records of physical presence (lease, hotel receipts) in case of audit',
      originState === 'WA' && destState === 'CA'
        ? 'WA has no income tax — CA Franchise Tax Board may audit for aggressive timing. Document move date thoroughly.'
        : '',
    ].filter(Boolean)

    return {
      move: {
        from: originState,
        to: destState,
        planned_date: moveDateStr,
        confirmed: plannedMove?.confirmed ?? false,
      },
      state_rates: {
        origin: parseFloat((originRate * 100).toFixed(2)),
        destination: parseFloat((destRate * 100).toFixed(2)),
        rate_increase_pct: parseFloat((rateDiff * 100).toFixed(2)),
      },
      events_before_move: analyzedBeforeMove,
      events_after_move: analyzedAfterMove,
      summary_of_events: {
        total_events: events.length,
        value_before_move: Math.round(valueBeforeMove),
        value_after_move: Math.round(valueAfterMove),
        state_tax_on_events_after_move: Math.round(taxOnAfterMoveInDest),
        state_tax_if_events_accelerated_to_before_move: Math.round(taxOnAfterMoveIfInOrigin),
        potential_state_tax_savings_from_accelerating: Math.round(taxSavingsIfAccelerate),
      },
      ca_source_income_note: destState === 'CA'
        ? 'California uses time-based proration for RSUs spanning the move date. The CA FTB taxes the fraction of each RSU\'s vesting period spent in CA. Grants that fully vest before you become a CA resident owe no CA tax.'
        : undefined,
      domicile_establishment: domicileFactors,
      key_risks: [
        rateDiff > 0.05 ? `Moving from ${originState} (${(originRate * 100).toFixed(1)}%) to ${destState} (${(destRate * 100).toFixed(1)}%) adds ${(rateDiff * 100).toFixed(1)}pp of state tax on all income after move date.` : null,
        'CA has an aggressive residency audit program. A part-year WA→CA move with large RSU vests before the move date may be scrutinized.',
        'Do not establish CA residency (lease, driver\'s license) before you intend to be taxed as a CA resident.',
        events.length === 0 ? 'No vesting events provided — add them via the vesting_events parameter for a detailed analysis.' : null,
      ].filter(Boolean),
      recommendation: taxSavingsIfAccelerate > 10_000
        ? `Accelerating post-move RSU/option events to before ${moveDateStr} could save up to $${Math.round(taxSavingsIfAccelerate).toLocaleString()} in ${destState} state income tax. Work with your employer on vest timing if possible.`
        : events.length === 0
          ? 'Provide upcoming vesting events to quantify the tax savings from move timing.'
          : `State tax difference on post-move events is $${Math.round(taxSavingsIfAccelerate).toLocaleString()}. Plan move date around major vest events.`,
    }
  },
})

// ---------------------------------------------------------------------------
// plan_foreign_accounts
// ---------------------------------------------------------------------------

// FBAR and FATCA thresholds — IRS/FinCEN requirements (see TECH_DEBT.md)
const FBAR_AGGREGATE_THRESHOLD = 10_000
const FATCA_THRESHOLD_SINGLE_YEAR_END = 50_000
const FATCA_THRESHOLD_SINGLE_ANY_TIME = 75_000
const FATCA_THRESHOLD_MFJ_YEAR_END = 100_000
const FATCA_THRESHOLD_MFJ_ANY_TIME = 150_000
const INDIA_TDS_RATE_NRO = 0.30  // 30% TDS on NRO interest income
const US_INDIA_TREATY_REDUCED_WITHHOLDING = 0.15  // reduced rate under treaty Article 11

export const planForeignAccounts = tool({
  description: `Analyze NRE/NRO (Indian bank) accounts and other foreign financial assets.
Covers: FBAR filing obligations (FinCEN 114), FATCA reporting (Form 8938), US tax treatment
of NRE interest (taxable in US despite India exemption) and NRO interest, foreign tax credit
to avoid double taxation, and remittance timing considerations under the US-India tax treaty.`,
  inputSchema: zodSchema(z.object({
    nre_balance_usd: z.number().optional().describe('NRE account balance in USD equivalent.'),
    nro_balance_usd: z.number().optional().describe('NRO account balance in USD equivalent.'),
    other_foreign_accounts_usd: z.number().optional().describe('Any other foreign financial account balances (USD equivalent).'),
    nre_annual_interest_usd: z.number().optional().describe('Annual interest earned on NRE account in USD.'),
    nro_annual_interest_usd: z.number().optional().describe('Annual interest earned on NRO account in USD.'),
    nro_tds_paid_usd: z.number().optional().describe('Indian TDS (Tax Deducted at Source) already paid on NRO interest, in USD. Used for foreign tax credit.'),
    usd_inr_rate: z.number().optional().describe('Current USD/INR exchange rate for conversion. Defaults to 84.'),
  })),
  execute: async ({
    nre_balance_usd = 0,
    nro_balance_usd = 0,
    other_foreign_accounts_usd = 0,
    nre_annual_interest_usd = 0,
    nro_annual_interest_usd = 0,
    nro_tds_paid_usd = 0,
    usd_inr_rate = 84,
  }) => {
    const profile = loadProfile()
    const filingStatus = profile.tax.filing_status
    const marginalRate = profile.tax.marginal_federal_rate
    const stateRate = getStateRate(profile.tax.state)

    const aggregateForeignBalance = nre_balance_usd + nro_balance_usd + other_foreign_accounts_usd

    // FBAR obligation
    const fbarRequired = aggregateForeignBalance > FBAR_AGGREGATE_THRESHOLD
    const fbarDue = 'April 15 (auto-extended to October 15)'

    // FATCA obligation (Form 8938)
    const fatcaYearEndThreshold = filingStatus === 'married_filing_jointly'
      ? FATCA_THRESHOLD_MFJ_YEAR_END
      : FATCA_THRESHOLD_SINGLE_YEAR_END
    const fatcaAnyTimeThreshold = filingStatus === 'married_filing_jointly'
      ? FATCA_THRESHOLD_MFJ_ANY_TIME
      : FATCA_THRESHOLD_SINGLE_ANY_TIME
    const fatcaRequired = aggregateForeignBalance > fatcaYearEndThreshold  // simplified

    // US tax on NRE interest
    // NRE interest is exempt from Indian income tax — but it is taxable in the US
    const usTaxOnNreInterest = nre_annual_interest_usd * (marginalRate + stateRate)

    // US tax on NRO interest
    // India withholds 30% TDS (or 15% under treaty with Form 10F/Tax Residency Certificate)
    // Foreign tax credit on Form 1116 reduces US tax by amount paid in India
    const usTaxOnNroBeforeCredit = nro_annual_interest_usd * (marginalRate + stateRate)
    const foreignTaxCreditNro = Math.min(nro_tds_paid_usd, usTaxOnNroBeforeCredit)
    const usTaxOnNroAfterCredit = Math.max(0, usTaxOnNroBeforeCredit - foreignTaxCreditNro)

    const totalAdditionalUsTax = usTaxOnNreInterest + usTaxOnNroAfterCredit
    const totalForeignInterest = nre_annual_interest_usd + nro_annual_interest_usd

    return {
      account_summary: {
        nre_balance_usd: Math.round(nre_balance_usd),
        nro_balance_usd: Math.round(nro_balance_usd),
        other_foreign_usd: Math.round(other_foreign_accounts_usd),
        aggregate_foreign_balance_usd: Math.round(aggregateForeignBalance),
        usd_inr_rate_used: usd_inr_rate,
      },
      fbar: {
        required: fbarRequired,
        form: 'FinCEN 114 (FBAR)',
        threshold_usd: FBAR_AGGREGATE_THRESHOLD,
        aggregate_balance_usd: Math.round(aggregateForeignBalance),
        due_date: fbarDue,
        how_to_file: 'File electronically at fincen.gov/bsa-e-filing. Report ALL foreign accounts with >$10k aggregate at any point during the year.',
        penalty_non_willful: 'Up to $10,000 per violation per year',
        penalty_willful: 'Greater of $100,000 or 50% of account balance per violation',
        note: fbarRequired
          ? `Your aggregate foreign balance ($${Math.round(aggregateForeignBalance).toLocaleString()}) exceeds the $${FBAR_AGGREGATE_THRESHOLD.toLocaleString()} threshold. File FBAR annually.`
          : `Aggregate balance ($${Math.round(aggregateForeignBalance).toLocaleString()}) is below the $${FBAR_AGGREGATE_THRESHOLD.toLocaleString()} FBAR threshold — no FBAR required unless balances were higher at any point during the year.`,
      },
      fatca: {
        required: fatcaRequired,
        form: 'Form 8938 (FATCA)',
        threshold_year_end: fatcaYearEndThreshold,
        threshold_any_time: fatcaAnyTimeThreshold,
        due_date: 'With your federal tax return (April 15, or October 15 with extension)',
        note: fatcaRequired
          ? `File Form 8938 with your tax return. Disclose all specified foreign financial assets.`
          : `Below FATCA threshold — Form 8938 not required unless balance exceeds $${fatcaYearEndThreshold.toLocaleString()} at year end or $${fatcaAnyTimeThreshold.toLocaleString()} at any point.`,
        penalty: '$10,000 failure to file; additional $10,000 per 30 days after IRS notice (max $50,000)',
      },
      nre_account: {
        nature: 'Non-Resident External (NRE) — INR/foreign currency, fully repatriable',
        india_tax_status: 'Interest exempt from Indian income tax',
        us_tax_status: 'Interest IS taxable in the US as ordinary income (despite India exemption)',
        annual_interest_usd: Math.round(nre_annual_interest_usd),
        us_tax_owed: Math.round(usTaxOnNreInterest),
        effective_rate_pct: parseFloat(((marginalRate + stateRate) * 100).toFixed(1)),
        common_misconception: 'Many NRIs mistakenly believe NRE interest is US tax-free because it is India tax-free. The IRS does not honor India\'s domestic exemption — you must report NRE interest on your US return.',
      },
      nro_account: {
        nature: 'Non-Resident Ordinary (NRO) — INR, restricted repatriation (up to $1M/yr with CA certificate)',
        india_tax_status: `India withholds ${(INDIA_TDS_RATE_NRO * 100).toFixed(0)}% TDS on NRO interest (reducible to ${(US_INDIA_TREATY_REDUCED_WITHHOLDING * 100).toFixed(0)}% with treaty claim via Form 10F)`,
        us_tax_status: 'Interest taxable in US; Indian TDS qualifies for US foreign tax credit (Form 1116)',
        annual_interest_usd: Math.round(nro_annual_interest_usd),
        tds_paid_usd: Math.round(nro_tds_paid_usd),
        us_tax_before_credit: Math.round(usTaxOnNroBeforeCredit),
        foreign_tax_credit: Math.round(foreignTaxCreditNro),
        us_tax_after_credit: Math.round(usTaxOnNroAfterCredit),
        treaty_note: 'File Form 10F with your Indian bank to claim the reduced 15% treaty rate under Article 11 of the US-India tax treaty (vs 30% standard TDS). Obtain a US Tax Residency Certificate (Form 6166) to support the claim.',
      },
      us_india_treaty: {
        treaty: 'US-India Income Tax Treaty (1989)',
        relevant_articles: [
          'Article 11 (Interest): Max 15% withholding on interest paid by Indian entities to US residents',
          'Article 22 (Relief from Double Taxation): Foreign tax credit mechanism',
          'Article 4 (Residence): Tie-breaker rules for dual residents',
        ],
        action: 'Obtain IRS Form 6166 (US Tax Residency Certificate) annually — submit to your Indian bank to claim treaty benefits and reduce NRO TDS from 30% to 15%.',
      },
      tax_summary: {
        total_foreign_interest_usd: Math.round(totalForeignInterest),
        additional_us_tax_owed: Math.round(totalAdditionalUsTax),
        foreign_tax_credit_claimed: Math.round(foreignTaxCreditNro),
        net_cost_of_foreign_accounts: Math.round(totalAdditionalUsTax),
      },
      remittance_considerations: [
        'NRE funds: freely repatriable at any time — no RBI approval needed',
        'NRO funds: up to USD $1 million per financial year with Form 15CA/15CB and CA certificate',
        'Large remittances from NRO should be timed to manage US AGI impact (e.g. avoid a vest year)',
        'Exchange rate timing can matter for large balances — consider hedging for amounts > $50k',
      ],
      recommended_actions: [
        fbarRequired ? '✓ File FBAR (FinCEN 114) annually — electronically at BSA e-Filing system' : null,
        fatcaRequired ? '✓ File Form 8938 with your tax return' : null,
        nro_annual_interest_usd > 0 ? '✓ Claim foreign tax credit (Form 1116) for Indian TDS paid on NRO interest' : null,
        nro_annual_interest_usd > 0 ? '✓ Obtain Form 6166 from IRS and submit to Indian bank to reduce NRO TDS to 15%' : null,
        nre_annual_interest_usd > 0 ? '✓ Report NRE interest on Schedule B — it is US-taxable despite India exemption' : null,
        '✓ Maintain records of account statements, TDS certificates (Form 16A), and exchange rates used',
      ].filter(Boolean),
    }
  },
})

// ---------------------------------------------------------------------------
// plan_gift_and_inheritance
// ---------------------------------------------------------------------------

export const planGiftAndInheritance = tool({
  description: `Plan asset transfers from parents (or other donors): annual gift tax exclusions,
lifetime exemption tracking, optimal gifting strategy (cash vs appreciated assets),
stepped-up basis on inherited assets, and estate tax considerations.
Covers: $18,000 annual exclusion per donor/recipient, $13.99M lifetime exemption (2025),
529 superfunding, and the difference between gifting vs inheriting appreciated assets.`,
  inputSchema: zodSchema(z.object({
    donor_count: z.number().optional().describe('Number of donors (e.g. 2 for both parents). Defaults to 2.'),
    assets_to_transfer: z.array(z.object({
      description: z.string(),
      current_value: z.number(),
      cost_basis: z.number().describe('Original purchase price. 0 if unknown.'),
      asset_type: z.enum(['cash', 'appreciated_stock', 'real_estate', 'mutual_fund', 'other']),
    })).optional().describe('Assets being considered for transfer.'),
    transfer_timeline_years: z.number().optional().describe('Number of years over which to plan transfers. Defaults to 5.'),
    recipient_count: z.number().optional().describe('Number of recipients in your household (you + spouse). Defaults to 1.'),
    donor_estate_value_estimate: z.number().optional().describe('Rough total estate value of donors (to flag estate tax risk). Optional.'),
  })),
  execute: async ({
    donor_count = 2,
    assets_to_transfer = [],
    transfer_timeline_years = 5,
    recipient_count = 1,
    donor_estate_value_estimate,
  }) => {
    const profile = loadProfile()
    const filingStatus = profile.tax.filing_status
    const marginalRate = profile.tax.marginal_federal_rate
    const stateRate = getStateRate(profile.tax.state)
    const ltcgRate = profile.tax.long_term_cap_gains_rate
    const agi = profile.tax.estimated_agi

    const annualExclusion = ANNUAL_GIFT_EXCLUSION  // $18,000
    const lifetimeExemption = LIFETIME_ESTATE_EXEMPTION  // $13.99M

    // Annual gift capacity
    const annualGiftCapacity = annualExclusion * donor_count * recipient_count
    const fiveYearGiftCapacity = annualGiftCapacity * transfer_timeline_years

    // TCJA sunset note: the elevated $13.99M exemption sunsets after 2025 unless extended
    const tcjaSunsetNote = 'The elevated lifetime exemption (~$13.99M for 2025) is scheduled to sunset after 2025, reverting to ~$7M (inflation-adjusted). Gifts made before sunset lock in the higher exemption. Consider accelerating large gifts before December 31, 2025.'

    // Analyze each asset
    const assetAnalysis = assets_to_transfer.map(a => {
      const unrealizedGain = a.current_value - a.cost_basis
      const unrealizedGainPct = a.cost_basis > 0 ? unrealizedGain / a.cost_basis : null

      // Tax if sold by donor today
      const isNiit = niitApplies(agi, filingStatus)
      const ltcgTaxIfSold = unrealizedGain > 0
        ? unrealizedGain * (ltcgRate + stateRate + (isNiit ? NIIT_RATE : 0))
        : 0

      // Option A: Gift appreciated asset to recipient
      // Recipient takes donor's cost basis — same embedded gain
      // If recipient sells, they pay capital gains on donor's basis
      const recipientGainIfSoldAfterGift = unrealizedGain
      const recipientTaxIfSoldAfterGift = recipientGainIfSoldAfterGift > 0
        ? recipientGainIfSoldAfterGift * (ltcgRate + stateRate)
        : 0

      // Option B: Inherit at death (stepped-up basis)
      // Basis resets to FMV at date of death — no embedded gain
      const taxSavingsFromInheritanceVsGift = recipientTaxIfSoldAfterGift

      // Option C: Donate to DAF (charitable — no capital gains at all)
      const taxSavingsIfDonatedToDAF = ltcgTaxIfSold  // avoids the gain entirely

      return {
        description: a.description,
        current_value: Math.round(a.current_value),
        cost_basis: a.cost_basis,
        unrealized_gain: Math.round(unrealizedGain),
        unrealized_gain_pct: unrealizedGainPct !== null ? parseFloat((unrealizedGainPct * 100).toFixed(1)) : null,
        embedded_tax_if_donor_sells: Math.round(ltcgTaxIfSold),
        options: {
          gift_now: {
            description: 'Gift asset to recipient — recipient takes over donor\'s cost basis',
            recipient_embedded_gain: Math.round(recipientGainIfSoldAfterGift),
            recipient_tax_if_sold: Math.round(recipientTaxIfSoldAfterGift),
            gift_tax_triggered: a.current_value > annualGiftCapacity,
            note: a.asset_type === 'appreciated_stock' && unrealizedGain > 0
              ? 'Gifting appreciated stock avoids donor\'s capital gains tax. But recipient inherits carryover basis — the gain travels with the asset.'
              : undefined,
          },
          inherit_at_death: {
            description: 'Hold until death — recipient inherits with stepped-up basis',
            recipient_tax_if_sold_immediately: 0,
            basis_reset_to_fmv: true,
            tax_savings_vs_gift: Math.round(taxSavingsFromInheritanceVsGift),
            note: 'Stepped-up basis eliminates all embedded capital gains. Best for highly appreciated assets held until death.',
          },
          donate_to_daf: {
            description: 'Donate appreciated asset to Donor-Advised Fund — no capital gains, full deduction',
            tax_savings: Math.round(taxSavingsIfDonatedToDAF),
            note: 'DAF donation of appreciated assets avoids all capital gains AND generates a charitable deduction at FMV. Best for assets with very large gains (>50% of value).',
          },
        },
        recommendation: unrealizedGain > a.current_value * 0.5
          ? 'High embedded gain (>50% of value) — inheritance with stepped-up basis or DAF donation beats outright gift. Avoid gifting if donor expects to hold until death.'
          : unrealizedGain < 0
            ? 'Asset is at a loss — sell to harvest the loss, then gift cash proceeds.'
            : 'Moderate gain — gift is reasonable but recipient will inherit embedded tax liability.',
      }
    })

    // Annual gifting schedule
    const schedule = Array.from({ length: transfer_timeline_years }, (_, i) => ({
      year: new Date().getFullYear() + i,
      annual_gift_capacity: annualGiftCapacity,
      cumulative_tax_free_transferred: annualGiftCapacity * (i + 1),
    }))

    // Estate tax flag
    const estateTaxRisk = donor_estate_value_estimate !== undefined && donor_estate_value_estimate > lifetimeExemption

    return {
      gift_tax_rules: {
        annual_exclusion_per_donor_per_recipient: annualExclusion,
        donor_count,
        recipient_count,
        annual_gift_capacity_total: annualGiftCapacity,
        lifetime_exemption: lifetimeExemption,
        tax_year: TAX_YEAR,
        tcja_sunset_warning: tcjaSunsetNote,
      },
      annual_gifting_schedule: schedule,
      total_tax_free_over_timeline: annualGiftCapacity * transfer_timeline_years,
      asset_analysis: assetAnalysis,
      estate_tax: {
        donor_estate_estimate: donor_estate_value_estimate ?? 'not provided',
        lifetime_exemption: lifetimeExemption,
        estate_tax_risk: estateTaxRisk,
        note: estateTaxRisk
          ? `Donor estate (~$${(donor_estate_value_estimate!).toLocaleString()}) may exceed the ${TAX_YEAR} lifetime exemption ($${lifetimeExemption.toLocaleString()}). Gifting assets now reduces the taxable estate and may lock in the pre-sunset higher exemption. Consult an estate planning attorney.`
          : 'Estate tax likely not an issue at current thresholds, but TCJA sunset in 2026 may halve the exemption.',
      },
      key_strategies: [
        `Annual exclusion gifting: each parent can give $${annualExclusion.toLocaleString()} to each recipient tax-free. Two parents + one recipient = $${annualExclusion * 2 * recipient_count}.toLocaleString()}/year without using lifetime exemption.`,
        'Gift cash for living expenses rather than appreciated assets — recipients avoid inherited embedded gains.',
        'For highly appreciated assets: strongly prefer inheritance (stepped-up basis) over gift if donors will hold until death.',
        '529 superfunding: contribute up to $90,000 per beneficiary in one year (5-year gift tax averaging). Grandparents can fund grandchild\'s college in one lump sum.',
        tcjaSunsetNote,
      ],
      forms_required: [
        'IRS Form 709 (Gift Tax Return): Required if any single donor gives more than $18,000 to any single recipient in a year. Due April 15.',
        'No gift tax actually owed until lifetime exemption is exhausted ($13.99M).',
      ],
    }
  },
})

// ---------------------------------------------------------------------------
// plan_concentration_unwind
// ---------------------------------------------------------------------------

export const planConcentrationUnwind = tool({
  description: `Create a tax-aware plan for unwinding concentrated stock positions (e.g. Meta, Amazon).
Models multi-year sell schedule to stay within LTCG brackets, quantifies charitable giving via DAF,
and flags constructive sale rules. Helps reduce single-stock risk while minimizing taxes paid.`,
  inputSchema: zodSchema(z.object({
    ticker: z.string().optional().describe('Ticker of the concentrated position to analyze. If omitted, analyzes all concentrated positions (>10% of taxable portfolio).'),
    target_concentration_pct: z.number().optional().describe('Target maximum concentration as % of portfolio. Defaults to 10%.'),
    years_to_unwind: z.number().optional().describe('Years over which to spread the sale. Defaults to 5.'),
    charitable_pct: z.number().optional().describe('Percentage of gains to redirect to a DAF (Donor-Advised Fund). Defaults to 0.'),
    annual_income_other: z.number().optional().describe('Other annual income (besides gains from this position) for bracket calculation. Defaults to profile AGI.'),
  })),
  execute: async ({
    ticker,
    target_concentration_pct = 10,
    years_to_unwind = 5,
    charitable_pct = 0,
    annual_income_other,
  }) => {
    const profile = loadProfile()
    const filingStatus = profile.tax.filing_status
    const baseAgi = annual_income_other ?? profile.tax.estimated_agi
    const ltcgRate = profile.tax.long_term_cap_gains_rate
    const stateRate = getStateRate(profile.tax.state)
    const isNiit = niitApplies(baseAgi, filingStatus)
    const totalPortfolioValue = profile.accounts.reduce((s, a) => s + a.balance, 0)

    // Find concentrated positions in taxable accounts
    const taxableAccounts = profile.accounts.filter(a => a.tax_treatment === 'taxable')

    type ConcentratedPosition = {
      ticker: string
      shares: number
      current_price: number
      cost_basis_per_share: number
      market_value: number
      cost_basis_total: number
      unrealized_gain: number
      gain_pct: number
      portfolio_pct: number
      is_long_term: boolean | null
    }

    const concentratedPositions: ConcentratedPosition[] = []

    for (const account of taxableAccounts) {
      for (const holding of account.holdings) {
        if (ticker && holding.ticker.toUpperCase() !== ticker.toUpperCase()) continue

        const mv = holdingMarketValue(holding)
        const cb = holding.cost_basis_per_share * holding.shares
        const gain = mv - cb
        const portfolioPct = totalPortfolioValue > 0 ? (mv / totalPortfolioValue) * 100 : 0

        if (!ticker && portfolioPct < target_concentration_pct) continue  // skip non-concentrated if no ticker specified

        const purchase = holding.purchase_date ? new Date(holding.purchase_date) : null
        const isLongTerm = purchase ? (Date.now() - purchase.getTime()) / 86400000 > 365 : null

        concentratedPositions.push({
          ticker: holding.ticker,
          shares: holding.shares,
          current_price: holding.current_price,
          cost_basis_per_share: holding.cost_basis_per_share,
          market_value: Math.round(mv),
          cost_basis_total: Math.round(cb),
          unrealized_gain: Math.round(gain),
          gain_pct: cb > 0 ? parseFloat(((gain / cb) * 100).toFixed(1)) : 0,
          portfolio_pct: parseFloat(portfolioPct.toFixed(1)),
          is_long_term: isLongTerm,
        })
      }
    }

    if (concentratedPositions.length === 0) {
      return {
        message: ticker
          ? `No ${ticker} holdings found in taxable accounts. Add holdings to a taxable account in your profile.`
          : `No positions exceed ${target_concentration_pct}% of portfolio in taxable accounts.`,
        total_portfolio_value: Math.round(totalPortfolioValue),
      }
    }

    const positionAnalyses = concentratedPositions.map(pos => {
      const targetValue = totalPortfolioValue * (target_concentration_pct / 100)
      const excessValue = Math.max(0, pos.market_value - targetValue)
      const excessShares = pos.current_price > 0 ? Math.floor(excessValue / pos.current_price) : 0

      // Gain rate on excess shares (same proportional basis)
      const gainRatePerShare = pos.shares > 0 ? pos.unrealized_gain / pos.shares : 0
      const gainOnExcess = gainRatePerShare * excessShares
      const charitableGain = gainOnExcess * (charitable_pct / 100)
      const taxableGain = gainOnExcess - charitableGain

      // Tax if sold all at once
      const combinedLtcgRate = ltcgRate + stateRate + (isNiit ? NIIT_RATE : 0)
      const taxIfSoldAllAtOnce = taxableGain * combinedLtcgRate
      const charityTaxSavings = charitableGain * combinedLtcgRate  // avoided by donating appreciated shares

      // Multi-year sell schedule
      const sharesPerYear = Math.ceil(excessShares / years_to_unwind)
      const gainPerYear = gainRatePerShare * sharesPerYear
      const taxPerYear = gainPerYear * combinedLtcgRate

      const sellSchedule = Array.from({ length: years_to_unwind }, (_, i) => {
        const sharesThisYear = Math.min(sharesPerYear, excessShares - sharesPerYear * i)
        const gainThisYear = gainRatePerShare * sharesThisYear
        return {
          year: new Date().getFullYear() + i,
          shares_to_sell: Math.max(0, sharesThisYear),
          proceeds: Math.round(sharesThisYear * pos.current_price),
          taxable_gain: Math.round(gainThisYear * (1 - charitable_pct / 100)),
          tax_owed: Math.round(gainThisYear * (1 - charitable_pct / 100) * combinedLtcgRate),
          charitable_amount: Math.round(gainThisYear * (charitable_pct / 100)),
        }
      }).filter(y => y.shares_to_sell > 0)

      return {
        ticker: pos.ticker,
        current_concentration_pct: pos.portfolio_pct,
        target_concentration_pct,
        market_value: pos.market_value,
        unrealized_gain: pos.unrealized_gain,
        gain_pct: pos.gain_pct,
        is_long_term: pos.is_long_term,
        excess_value_to_trim: Math.round(excessValue),
        excess_shares_to_sell: excessShares,
        tax_analysis: {
          combined_ltcg_rate_pct: parseFloat((combinedLtcgRate * 100).toFixed(1)),
          includes_niit: isNiit,
          tax_if_sold_all_at_once: Math.round(taxIfSoldAllAtOnce),
          charitable_daf_allocation_pct: charitable_pct,
          tax_avoided_via_daf: Math.round(charityTaxSavings),
        },
        multi_year_sell_schedule: sellSchedule,
        total_tax_over_schedule: sellSchedule.reduce((s, y) => s + y.tax_owed, 0),
        total_charitable_over_schedule: sellSchedule.reduce((s, y) => s + y.charitable_amount, 0),
      }
    })

    const constructiveSaleWarning = `Constructive sale rules (IRC §1259): Do NOT hedge via short sale, equity swap, or forward contract on the concentrated stock — this triggers immediate recognition of all unrealized gain. Options strategies must be structured carefully (protective puts are generally OK; variable prepaid forwards may trigger constructive sale).`

    return {
      concentrated_positions: positionAnalyses,
      total_portfolio_value: Math.round(totalPortfolioValue),
      strategies: {
        tax_aware_sell_schedule: 'Spread sales over multiple years to stay within LTCG brackets and avoid pushing into higher ordinary income territory. Spreads market risk too.',
        charitable_giving_daf: charitable_pct > 0
          ? `Donating ${charitable_pct}% of each sale to a Donor-Advised Fund donates the shares at FMV (no capital gains) AND generates a charitable deduction. Net tax efficiency much higher than selling and donating cash.`
          : 'Consider donating 10-20% of highly appreciated shares to a DAF — avoids capital gains entirely and generates a deduction.',
        exchange_fund: 'Exchange funds (private partnerships) allow swapping concentrated stock for a diversified basket without triggering capital gains. Typically require $1M+ minimum and 7-year lock-up. Ask a wealth manager about availability.',
        employee_stock_plan_ach: 'If shares come from RSU vests, diversify immediately at vest rather than holding — each vest creates a new lot at current price, minimizing future embedded gains.',
        tax_loss_harvesting: 'Harvest losses elsewhere in the portfolio to offset gains from the concentrated position sale — review other taxable holdings for offsetting losses.',
      },
      constructive_sale_warning: constructiveSaleWarning,
      recommended_priority: positionAnalyses.length > 0
        ? `Focus on ${positionAnalyses[0].ticker} first — ${positionAnalyses[0].current_concentration_pct}% of portfolio. Target: below ${target_concentration_pct}%.`
        : undefined,
    }
  },
})

// ---------------------------------------------------------------------------
// analyze_insurance_needs
// ---------------------------------------------------------------------------

// Insurance rule-of-thumb constants — see TECH_DEBT.md
const LIFE_INSURANCE_INCOME_MULTIPLE = 10   // 10x income replacement
const DISABILITY_INCOME_REPLACEMENT_PCT = 0.65  // 65% of income
const UMBRELLA_NET_WORTH_THRESHOLD = 500_000    // umbrella recommended above this net worth

export const analyzeInsuranceNeeds = tool({
  description: `Analyze life insurance, disability insurance, and umbrella policy needs.
Calculates income replacement amount for life insurance (10x income rule of thumb),
disability insurance gap (60-70% income target), and umbrella policy threshold
(based on net worth). Requires dependents and liabilities from profile for accuracy.`,
  inputSchema: zodSchema(z.object({
    existing_life_insurance_coverage: z.number().optional().describe('Total face value of existing life insurance policies. Defaults to 0.'),
    existing_disability_monthly_benefit: z.number().optional().describe('Monthly disability benefit from existing policy. Defaults to 0.'),
    existing_umbrella_limit: z.number().optional().describe('Existing umbrella policy limit. Defaults to 0.'),
  })),
  execute: async ({
    existing_life_insurance_coverage = 0,
    existing_disability_monthly_benefit = 0,
    existing_umbrella_limit = 0,
  }) => {
    const profile = loadProfile()

    const annualIncome = profile.income?.reduce((s, i) => s + i.annual_amount, 0) ?? 0
    const monthlyIncome = annualIncome / 12
    const hasDependents = (profile.dependents?.length ?? 0) > 0
    const primary = profile.household?.find(h => h.is_primary)
    const yearsToRetirement = primary ? Math.max(0, primary.retirement_age - primary.age) : 20

    // Life insurance
    const targetLifeCoverage = annualIncome * LIFE_INSURANCE_INCOME_MULTIPLE
    const totalLiabilities = profile.liabilities?.reduce((s, l) => s + l.balance, 0) ?? 0
    const lifeCoverageWithDebt = targetLifeCoverage + totalLiabilities
    const lifeInsuranceGap = Math.max(0, lifeCoverageWithDebt - existing_life_insurance_coverage)
    const lifeInsuranceExcess = Math.max(0, existing_life_insurance_coverage - lifeCoverageWithDebt)

    // Disability insurance
    const targetDisabilityMonthly = monthlyIncome * DISABILITY_INCOME_REPLACEMENT_PCT
    const disabilityGap = Math.max(0, targetDisabilityMonthly - existing_disability_monthly_benefit)
    const annualDisabilityGap = disabilityGap * 12

    // Umbrella
    const netWorth = profile.accounts.reduce((s, a) => s + a.balance, 0) - totalLiabilities
    const umbrellaNeeded = netWorth > UMBRELLA_NET_WORTH_THRESHOLD
    const recommendedUmbrellaLimit = netWorth > 0
      ? Math.ceil(netWorth / 1_000_000) * 1_000_000  // round up to nearest $1M
      : 1_000_000
    const umbrellaGap = Math.max(0, recommendedUmbrellaLimit - existing_umbrella_limit)

    return {
      life_insurance: {
        annual_income: Math.round(annualIncome),
        income_replacement_multiple: LIFE_INSURANCE_INCOME_MULTIPLE,
        target_coverage_income_replacement: Math.round(targetLifeCoverage),
        total_liabilities: Math.round(totalLiabilities),
        recommended_total_coverage: Math.round(lifeCoverageWithDebt),
        existing_coverage: Math.round(existing_life_insurance_coverage),
        coverage_gap: Math.round(lifeInsuranceGap),
        coverage_excess: Math.round(lifeInsuranceExcess),
        has_dependents: hasDependents,
        status: lifeInsuranceGap > 0 ? 'underinsured' : 'adequate',
        recommendation: hasDependents && lifeInsuranceGap > 0
          ? `Increase life insurance by $${Math.round(lifeInsuranceGap).toLocaleString()} to cover ${LIFE_INSURANCE_INCOME_MULTIPLE}x income + outstanding debt. Consider term life (20-30 year) while dependents are in the picture.`
          : !hasDependents
            ? 'No dependents — minimal life insurance needed unless you have debt co-signers or want estate liquidity.'
            : 'Life insurance coverage appears adequate.',
        term_vs_whole: 'Term life is almost always more cost-efficient for income replacement. Whole/universal life is only worth considering for estate planning or if you\'ve maxed all other tax-advantaged vehicles.',
      },
      disability_insurance: {
        monthly_income: Math.round(monthlyIncome),
        target_replacement_pct: DISABILITY_INCOME_REPLACEMENT_PCT * 100,
        target_monthly_benefit: Math.round(targetDisabilityMonthly),
        existing_monthly_benefit: Math.round(existing_disability_monthly_benefit),
        monthly_gap: Math.round(disabilityGap),
        annual_gap: Math.round(annualDisabilityGap),
        status: disabilityGap > 0 ? 'underinsured' : 'adequate',
        recommendation: disabilityGap > 0
          ? `Add $${Math.round(disabilityGap).toLocaleString()}/month in disability coverage. Your income is your largest asset — disability is far more likely than death for working-age professionals.`
          : 'Disability coverage appears adequate.',
        employer_coverage_note: 'Many employers offer group disability at 60% of base salary — check your benefits. Group policies have portability limitations; a private policy travels with you if you change jobs.',
        elimination_period: 'Choose a 90-day elimination period to balance premium cost vs coverage start — this assumes ~3 months of emergency fund coverage.',
      },
      umbrella_insurance: {
        estimated_net_worth: Math.round(netWorth),
        umbrella_recommended: umbrellaNeeded,
        recommended_limit: Math.round(recommendedUmbrellaLimit),
        existing_limit: Math.round(existing_umbrella_limit),
        gap: Math.round(umbrellaGap),
        status: umbrellaNeeded && umbrellaGap > 0 ? 'insufficient' : umbrellaNeeded ? 'adequate' : 'optional',
        recommendation: umbrellaNeeded && umbrellaGap > 0
          ? `Add umbrella policy of at least $${Math.round(recommendedUmbrellaLimit).toLocaleString()} to protect net worth of ~$${Math.round(netWorth).toLocaleString()}. Typical cost: $150-300/year per $1M in coverage.`
          : !umbrellaNeeded
            ? `Net worth is below the $${UMBRELLA_NET_WORTH_THRESHOLD.toLocaleString()} threshold where umbrella insurance is typically recommended.`
            : 'Umbrella limit appears sufficient.',
        prerequisites: 'Umbrella requires underlying auto and home/renters policy at minimum limits (typically $300k/$300k auto liability). Check that underlying policies meet the umbrella insurer\'s requirements.',
      },
      priority_order: [
        lifeInsuranceGap > 0 && hasDependents ? `1. Life insurance gap: $${Math.round(lifeInsuranceGap).toLocaleString()} (HIGH — dependents are unprotected)` : null,
        disabilityGap > 0 ? `${lifeInsuranceGap > 0 && hasDependents ? 2 : 1}. Disability insurance gap: $${Math.round(disabilityGap).toLocaleString()}/month (HIGH — your income is your largest asset)` : null,
        umbrellaGap > 0 && umbrellaNeeded ? `3. Umbrella policy gap: $${Math.round(umbrellaGap).toLocaleString()} limit (MEDIUM — protects accumulated assets)` : null,
      ].filter(Boolean),
    }
  },
})

// ---------------------------------------------------------------------------
// plan_estate_basics
// ---------------------------------------------------------------------------

export const planEstateBasics = tool({
  description: `Audit estate planning basics: beneficiary designations on all accounts,
will/trust status, guardianship designation for minor dependents, and TOD/POD designations.
Returns a checklist of what's in place vs what's missing, with specific action items.`,
  inputSchema: zodSchema(z.object({
    has_will: z.boolean().optional().describe('Whether you have a current will. Defaults to unknown.'),
    has_trust: z.boolean().optional().describe('Whether you have a revocable living trust. Defaults to unknown.'),
    has_healthcare_directive: z.boolean().optional().describe('Whether you have a healthcare directive / living will. Defaults to unknown.'),
    has_durable_poa: z.boolean().optional().describe('Whether you have a durable power of attorney. Defaults to unknown.'),
    guardian_designated: z.boolean().optional().describe('Whether a guardian has been legally designated for minor dependents. Defaults to unknown.'),
    accounts_with_beneficiaries: z.array(z.string()).optional().describe('List of account names/IDs that already have beneficiary designations on file.'),
  })),
  execute: async ({
    has_will,
    has_trust,
    has_healthcare_directive,
    has_durable_poa,
    guardian_designated,
    accounts_with_beneficiaries = [],
  }) => {
    const profile = loadProfile()

    const hasDependents = (profile.dependents?.length ?? 0) > 0
    const minorDependents = profile.dependents?.filter(d => d.age < 18) ?? []
    const hasMinorChildren = minorDependents.length > 0

    // Categorize accounts by whether they should have beneficiary designations
    const allAccounts = profile.accounts
    const retirementAccounts = allAccounts.filter(a =>
      a.tax_treatment === 'tax_deferred' || a.tax_treatment === 'tax_free'
    )
    const taxableAccounts = allAccounts.filter(a => a.tax_treatment === 'taxable')
    const cashAccounts = allAccounts.filter(a => a.tax_treatment === 'cash')

    const normalizedDesignated = accounts_with_beneficiaries.map(n => n.toLowerCase())

    const beneficiaryAudit = allAccounts.map(a => ({
      account: a.name,
      type: a.tax_treatment,
      beneficiary_on_file: normalizedDesignated.some(d => a.name.toLowerCase().includes(d) || a.id.toLowerCase().includes(d)),
      priority: a.tax_treatment === 'tax_deferred' || a.tax_treatment === 'tax_free' ? 'high' : 'medium',
      note: a.tax_treatment === 'tax_deferred' || a.tax_treatment === 'tax_free'
        ? 'Retirement accounts pass by beneficiary designation — supersedes will. Must be current.'
        : a.tax_treatment === 'taxable'
          ? 'Set TOD (Transfer on Death) designation to avoid probate.'
          : 'POD (Payable on Death) designation keeps cash accounts out of probate.',
    }))

    const accountsWithoutBeneficiary = beneficiaryAudit.filter(a => !a.beneficiary_on_file)
    const retirementWithoutBeneficiary = accountsWithoutBeneficiary.filter(a => a.priority === 'high')

    // Documents checklist
    const documentsChecklist = [
      {
        document: 'Will',
        status: has_will === true ? 'in_place' : has_will === false ? 'missing' : 'unknown',
        priority: 'high',
        note: has_will === false
          ? 'Without a will, assets pass via intestate succession — the state decides. Critical if you have children.'
          : 'Review will every 3-5 years or after major life events (marriage, divorce, new child, major asset purchase).',
        action: has_will !== true ? 'Draft a will with an estate attorney. Online options (Trust & Will, Fabric) are lower cost for straightforward situations.' : 'Review and confirm beneficiaries and executor are still current.',
      },
      {
        document: 'Revocable Living Trust',
        status: has_trust === true ? 'in_place' : has_trust === false ? 'not_established' : 'unknown',
        priority: 'medium',
        note: 'A trust avoids probate for assets titled in it, useful for real estate and larger estates. Not required if beneficiary designations and TOD/POD are in place on all accounts.',
        action: has_trust !== true && retirementAccounts.length > 0 && taxableAccounts.length > 0
          ? 'Consider a revocable living trust if you have real estate or want to avoid probate. Net worth above $500k often justifies the cost (~$1,500-3,000 with an attorney).'
          : undefined,
      },
      {
        document: 'Healthcare Directive / Living Will',
        status: has_healthcare_directive === true ? 'in_place' : has_healthcare_directive === false ? 'missing' : 'unknown',
        priority: 'high',
        note: 'Specifies medical wishes if you\'re incapacitated. Without it, family may need court involvement.',
        action: has_healthcare_directive !== true ? 'Complete a healthcare directive with your state\'s form. Many hospitals provide these.' : undefined,
      },
      {
        document: 'Durable Power of Attorney (Financial)',
        status: has_durable_poa === true ? 'in_place' : has_durable_poa === false ? 'missing' : 'unknown',
        priority: 'high',
        note: 'Allows a designated agent to manage financial affairs if you\'re incapacitated. Without it, family may need court-appointed guardianship.',
        action: has_durable_poa !== true ? 'Execute a durable POA with an estate attorney or notary.' : undefined,
      },
      {
        document: 'Guardian Designation (for minor children)',
        status: !hasMinorChildren ? 'not_applicable' : guardian_designated === true ? 'in_place' : guardian_designated === false ? 'missing' : 'unknown',
        priority: hasMinorChildren ? 'critical' : 'not_applicable',
        note: hasMinorChildren
          ? `You have ${minorDependents.length} minor dependent(s): ${minorDependents.map(d => `${d.name} (age ${d.age})`).join(', ')}. Without a guardian designation in your will, a court chooses.`
          : 'No minor children — guardian designation not applicable.',
        action: hasMinorChildren && guardian_designated !== true
          ? 'Name a guardian in your will ASAP — this is the most critical estate planning item for parents of minor children.'
          : undefined,
      },
    ]

    // Score overall estate readiness
    const criticalMissing = [
      has_will !== true,
      has_healthcare_directive !== true,
      has_durable_poa !== true,
      hasMinorChildren && guardian_designated !== true,
      retirementWithoutBeneficiary.length > 0,
    ].filter(Boolean).length

    const readinessScore = criticalMissing === 0 ? 'solid' : criticalMissing <= 2 ? 'needs_attention' : 'critical_gaps'

    return {
      readiness_score: readinessScore,
      critical_items_missing: criticalMissing,
      beneficiary_audit: {
        total_accounts: allAccounts.length,
        accounts_with_designation: allAccounts.length - accountsWithoutBeneficiary.length,
        accounts_missing_designation: accountsWithoutBeneficiary.length,
        retirement_accounts_missing: retirementWithoutBeneficiary.length,
        detail: beneficiaryAudit,
        priority_action: retirementWithoutBeneficiary.length > 0
          ? `URGENT: ${retirementWithoutBeneficiary.length} retirement account(s) have no beneficiary on file (${retirementWithoutBeneficiary.map(a => a.account).join(', ')}). These would be paid to your estate and lose the stretch IRA option. Add beneficiaries today via your account provider's website.`
          : 'Retirement account beneficiaries appear to be designated.',
      },
      documents_checklist: documentsChecklist,
      tod_pod_note: 'For taxable brokerage and savings accounts: set TOD (Transfer on Death) or POD (Payable on Death) designations so these accounts bypass probate. Do this through each institution\'s beneficiary designation form.',
      beneficiary_order_recommendation: {
        primary: 'Spouse (if married) — receives assets directly',
        contingent: 'Children equally (or in trust if minors) — receives if primary predeceases you',
        final_contingent: 'Your estate — last resort; avoid this as it triggers probate',
        per_stirpes_note: 'Name beneficiaries "per stirpes" (not "per capita") so that if a beneficiary predeceases you, their share passes to their children, not equally among surviving beneficiaries.',
      },
      immediate_actions: [
        ...documentsChecklist
          .filter(d => d.status === 'missing' || d.status === 'unknown')
          .map(d => d.action)
          .filter(Boolean),
        retirementWithoutBeneficiary.length > 0
          ? `Add beneficiaries to: ${retirementWithoutBeneficiary.map(a => a.account).join(', ')}`
          : null,
        accountsWithoutBeneficiary.filter(a => a.priority === 'medium').length > 0
          ? `Set TOD/POD on: ${accountsWithoutBeneficiary.filter(a => a.priority === 'medium').map(a => a.account).join(', ')}`
          : null,
      ].filter(Boolean),
      review_triggers: [
        'Marriage or divorce',
        'Birth or adoption of a child',
        'Death of a named beneficiary, executor, or guardian',
        'Major asset acquisition (home, large inheritance)',
        'Move to a new state (estate laws vary)',
        'Every 3-5 years regardless',
      ],
    }
  },
})
