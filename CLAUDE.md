# Claude Instructions for financial-planner

## Hardcoding rule

Whenever you choose to hardcode data, thresholds, or logic that could instead be sourced
from an external API, live data feed, or more scalable system, you MUST:

1. Use the hardcoded approach (as agreed) and proceed with the implementation.
2. Put the hardcoded value in the appropriate constants file (see below) — never inline
   it directly in a tool file or route.
3. Immediately add an entry to `TECH_DEBT.md` documenting:
   - Which file the hardcoding lives in
   - What exactly is hardcoded
   - Why (speed, no API key, personal-tool scope, etc.)
   - What a better solution looks like, with specific API/library candidates
   - What would trigger the need to fix it

Do not skip steps 2 or 3. This applies to: static lookup tables, hardcoded tax brackets,
hardcoded IRS limits, hardcoded fund metadata, hardcoded rate assumptions, and any other
data that changes in the real world or varies by user.

## Constants files — where hardcoded values live

All hardcoded reference data must be centralized in one of these files:

| File | What belongs there |
|------|--------------------|
| `src/lib/tax-data.ts` | IRS tax brackets, contribution limits, phaseout thresholds, NIIT, LTCG rates, state rates, standard deductions |
| `src/lib/fund-data.ts` | ETF/mutual fund metadata: tickers, expense ratios, index tracked, overlap groups, cheaper alternatives |
| `src/lib/strategies.ts` | Rule-of-thumb financial planning heuristics: target savings rates, glide path curves, asset class placement rules, emergency fund multiples |

Rules:
- Tool files (`src/lib/tools/*.ts`) must **import** constants — never define them inline.
- If a value could change year-to-year or user-to-user, it belongs in one of the files above.
- If none of the three files fits, create a new `src/lib/<domain>-data.ts` and document it here.

## Project context

- Stack: Next.js 16 App Router, Vercel AI SDK v6, Anthropic Claude
- All financial tools live in `src/lib/tools/` as TypeScript modules
- Tools return structured JSON — never pre-formatted recommendation strings
- The agent synthesizes tool results; tools are pure calculation primitives
- Profile data lives in `profile.json` at the project root (gitignored)
- See `TECH_DEBT.md` for known shortcuts and their planned replacements
