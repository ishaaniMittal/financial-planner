import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { SYSTEM_PROMPT } from '@/lib/prompts'

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: 'https://api.anthropic.com/v1',
})
import { getContributionLimits, checkContributionPace, calculateTaxBracket, detectIdleCash, suggestRebalancing } from '@/lib/tools/cash-flow'
import { getPlacementRules, optimizeAssetLocation, calculateTaxDrag, analyzeHoldings, analyzeTaxOpportunities } from '@/lib/tools/asset-location'
import { visualize, saveToReport } from '@/lib/tools/visualization'
import { projectRetirement, analyzeGoalFunding } from '@/lib/tools/planning'

export const maxDuration = 60

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()
  const modelMessages = await convertToModelMessages(messages)

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: SYSTEM_PROMPT,
    messages: modelMessages,
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
      visualize,
      save_to_report: saveToReport,
    },
    stopWhen: stepCountIs(10),
  })

  return result.toUIMessageStreamResponse()
}
