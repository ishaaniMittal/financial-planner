import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { SYSTEM_PROMPT } from '@/lib/prompts'

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: 'https://api.anthropic.com/v1',
})
import { getContributionLimits, checkContributionPace, calculateTaxBracket, detectIdleCash, suggestRebalancing, calculateSavingsRate } from '@/lib/tools/cash-flow'
import { getPlacementRules, optimizeAssetLocation, calculateTaxDrag, analyzeHoldings, analyzeTaxOpportunities } from '@/lib/tools/asset-location'
import { visualize, saveToReport } from '@/lib/tools/visualization'
import { projectRetirement, analyzeGoalFunding } from '@/lib/tools/planning'
import { checkEmployerMatch, checkRothEligibility, analyzeAssetClassAllocation } from '@/lib/tools/portfolio-checks'
import { analyzeFundOverlap } from '@/lib/tools/fund-analysis'
import { planRsuTaxes, planRothConversion } from '@/lib/tools/advanced-tax'
import { runFinancialDiagnostic } from '@/lib/tools/diagnostic'
import { analyzeMegaBackdoorRoth, compareHealthPlans, planStockOptions, plan529, calculateNetWorth } from '@/lib/tools/benefits-equity'
import { planStateResidencyTiming, planForeignAccounts, planGiftAndInheritance, planConcentrationUnwind, analyzeInsuranceNeeds, planEstateBasics } from '@/lib/tools/specialized'
import { updateProfile } from '@/lib/tools/profile-write'

export const maxDuration = 60

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()
  const modelMessages = await convertToModelMessages(messages)

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: SYSTEM_PROMPT,
    messages: modelMessages,
    providerOptions: {
      anthropic: {
        // Cache system prompt + tool schemas across requests in the same 5-min window.
        // First request pays 1.25x write cost; subsequent requests pay 0.1x read cost.
        // Net effect: ~85% token cost reduction on the static parts every turn after the first.
        cacheControl: { type: 'ephemeral' },
        // As conversations grow, old tool results accumulate as input tokens.
        // The diagnostic alone returns thousands of tokens — we don't need that verbatim
        // in context 10 turns later. This setting prunes tool result blocks automatically,
        // keeping only the 3 most recent tool exchanges, once 10 total tool uses have occurred.
        contextManagement: {
          edits: [{
            type: 'clear_tool_uses_20250919',
            trigger: { type: 'tool_uses', value: 10 },
            keep: { type: 'tool_uses', value: 3 },
          }],
        },
      },
    },
    tools: {
      get_contribution_limits: getContributionLimits,
      check_contribution_pace: checkContributionPace,
      calculate_tax_bracket: calculateTaxBracket,
      detect_idle_cash: detectIdleCash,
      suggest_rebalancing: suggestRebalancing,
      get_placement_rules: getPlacementRules,
      optimize_asset_location: optimizeAssetLocation,
      calculate_tax_drag: calculateTaxDrag,
      analyze_holdings: analyzeHoldings,
      analyze_tax_opportunities: analyzeTaxOpportunities,
      project_retirement: projectRetirement,
      analyze_goal_funding: analyzeGoalFunding,
      check_employer_match: checkEmployerMatch,
      check_roth_eligibility: checkRothEligibility,
      analyze_asset_class_allocation: analyzeAssetClassAllocation,
      analyze_fund_overlap: analyzeFundOverlap,
      plan_rsu_taxes: planRsuTaxes,
      plan_roth_conversion: planRothConversion,
      run_financial_diagnostic: runFinancialDiagnostic,
      analyze_mega_backdoor_roth: analyzeMegaBackdoorRoth,
      compare_health_plans: compareHealthPlans,
      plan_stock_options: planStockOptions,
      plan_529: plan529,
      calculate_net_worth: calculateNetWorth,
      calculate_savings_rate: calculateSavingsRate,
      plan_state_residency_timing: planStateResidencyTiming,
      plan_foreign_accounts: planForeignAccounts,
      plan_gift_and_inheritance: planGiftAndInheritance,
      plan_concentration_unwind: planConcentrationUnwind,
      analyze_insurance_needs: analyzeInsuranceNeeds,
      plan_estate_basics: planEstateBasics,
      update_profile: updateProfile,
      visualize,
      save_to_report: saveToReport,
    },
    stopWhen: stepCountIs(25),
  })

  return result.toUIMessageStreamResponse()
}
