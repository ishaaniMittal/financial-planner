import fs from 'fs'
import path from 'path'
import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { loadProfile, invalidateProfileCache, type FinancialProfile } from '../profile'

const PROFILE_PATH = path.join(process.cwd(), 'profile.json')

// Keys that identify array items for in-place update vs append.
// Order matters: first match wins.
const ARRAY_ID_KEYS: Record<string, string[]> = {
  accounts:       ['id', 'name'],
  goals:          ['name'],
  income:         ['source'],
  household:      ['name'],
  dependents:     ['name'],
  liabilities:    ['name'],
  stock_options:  ['grant_id'],
  spending:       ['category'],
  planned_moves:  ['from_state', 'to_state'],
  monthly_history:['month'],
  liquidity_needs:['name', 'label'],
}

function findIdKey(field: string, item: Record<string, unknown>): string | null {
  const candidates = ARRAY_ID_KEYS[field] ?? ['id', 'name']
  return candidates.find(k => item[k] !== undefined) ?? null
}

/**
 * Merge patch into current, following these rules:
 *   - Scalar fields: overwrite
 *   - Object fields (tax, benefits): shallow merge
 *   - Array fields: update existing item if identity key matches; otherwise append
 *
 * Holdings within accounts are handled as a sub-merge keyed on `ticker`.
 */
function mergeProfile(
  current: FinancialProfile,
  patch: Record<string, unknown>,
): { next: FinancialProfile; changes: string[] } {
  const next = structuredClone(current) as unknown as Record<string, unknown>
  const changes: string[] = []

  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined || value === null) continue

    const existing = next[field]

    if (Array.isArray(value)) {
      if (!Array.isArray(existing)) {
        next[field] = value
        changes.push(`set ${field} = ${JSON.stringify(value)}`)
        continue
      }

      const arr = existing as Record<string, unknown>[]
      for (const item of value as Record<string, unknown>[]) {
        const idKey = findIdKey(field, item)
        const idx = idKey != null
          ? arr.findIndex(e => e[idKey] === item[idKey])
          : -1

        if (idx >= 0) {
          // In-place update — preserve fields not in the patch item
          const merged = { ...arr[idx], ...item }

          // Sub-merge holdings array within an account patch
          if (field === 'accounts' && Array.isArray(item['holdings']) && Array.isArray(arr[idx]['holdings'])) {
            const existingHoldings = arr[idx]['holdings'] as Record<string, unknown>[]
            const patchHoldings = item['holdings'] as Record<string, unknown>[]
            const mergedHoldings = [...existingHoldings]
            for (const h of patchHoldings) {
              const hi = mergedHoldings.findIndex(e => e['ticker'] === h['ticker'])
              if (hi >= 0) mergedHoldings[hi] = { ...mergedHoldings[hi], ...h }
              else mergedHoldings.push(h)
            }
            merged['holdings'] = mergedHoldings
          }

          arr[idx] = merged
          changes.push(`updated ${field}[${idKey ? item[idKey] : idx}]`)
        } else {
          arr.push(item)
          const idKey2 = findIdKey(field, item)
          changes.push(`appended ${field}[${idKey2 ? item[idKey2] : 'new'}]`)
        }
      }
      next[field] = arr

    } else if (typeof value === 'object' && typeof existing === 'object' && !Array.isArray(existing)) {
      // Shallow-merge objects (tax, benefits, extensions, etc.)
      next[field] = { ...(existing as object), ...(value as object) }
      changes.push(`merged ${field}`)

    } else {
      next[field] = value
      changes.push(`set ${field} = ${JSON.stringify(value)}`)
    }
  }

  return { next: next as unknown as FinancialProfile, changes }
}

export const updateProfile = tool({
  description: `Update the user's financial profile (profile.json) with new or corrected information.
Call this whenever the user states something that should be persisted: a new salary, a new RSU grant,
a state move, a changed account balance, a new goal, updated spending, new liabilities, etc.

Pass \`updates_json\` as a JSON string of a partial FinancialProfile — include only the fields you want to change.

Array fields (accounts, goals, income, dependents, liabilities, stock_options, spending,
planned_moves, household): supply an array of items. Each item is matched by its identity key
(id/name/grant_id/source/category/from_state+to_state) and updated in-place. If no match is found,
the item is appended. You do NOT need to supply the full existing array — just the items you want
to add or change.

Object fields (tax, benefits): supply only the sub-keys you want to change; the rest are preserved.

Scalar fields (risk_tolerance, total_annual_investable, target_emergency_fund,
current_month, current_year): supply the new value directly.

Examples (as updates_json strings):
- Salary change: '{"income":[{"source":"Meta","annual_amount":480000}]}'
- New RSU grant: '{"stock_options":[{"grant_id":"amzn-2025-01","ticker":"AMZN","type":"NSO",...}]}'
- State move: '{"tax":{"state":"CA"},"planned_moves":[{"from_state":"WA","to_state":"CA","planned_date":"2025-09-01","confirmed":true}]}'
- Account balance: '{"accounts":[{"id":"401k","balance":152000}]}'
- New goal: '{"goals":[{"name":"Home down payment","target_amount":200000,"target_date":"2027-01-01","priority":1,"current_progress":45000,"monthly_contribution":3000}]}'`,

  inputSchema: zodSchema(z.object({
    updates_json: z.string().describe(
      'JSON string of a partial FinancialProfile object. Only include fields you want to add or change. Example: {"income":[{"source":"Meta","annual_amount":480000}]}'
    ),
    reason: z.string().describe(
      'One-sentence description of what changed and why (shown in the change log).'
    ),
  })),

  execute: async (args: { updates_json: string; reason: string }): Promise<{
    success: boolean
    reason: string
    changes_applied: string[]
    fields_updated: string[]
    error?: string
  }> => {
    const { updates_json, reason } = args
    let updates: Record<string, unknown>
    try {
      updates = JSON.parse(updates_json)
    } catch {
      return { success: false, error: 'updates_json is not valid JSON', reason, changes_applied: [], fields_updated: [] }
    }
    const current = loadProfile()
    const { next, changes } = mergeProfile(current, updates)

    fs.writeFileSync(PROFILE_PATH, JSON.stringify(next, null, 2), 'utf-8')
    invalidateProfileCache()

    return {
      success: true,
      reason,
      changes_applied: changes,
      fields_updated: Object.keys(updates),
    }
  },
})
