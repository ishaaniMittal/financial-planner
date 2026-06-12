# Claude Instructions for financial-planner

## Hardcoding rule

Whenever you choose to hardcode data, thresholds, or logic that could instead be sourced
from an external API, live data feed, or more scalable system, you MUST:

1. Use the hardcoded approach (as agreed) and proceed with the implementation.
2. Immediately add an entry to `TECH_DEBT.md` documenting:
   - Which file the hardcoding lives in
   - What exactly is hardcoded
   - Why (speed, no API key, personal-tool scope, etc.)
   - What a better solution looks like, with specific API/library candidates
   - What would trigger the need to fix it

Do not skip this step. The entry goes in `TECH_DEBT.md` in the project root.
This applies to: static lookup tables, hardcoded tax brackets, hardcoded IRS limits,
hardcoded fund metadata, hardcoded rate assumptions, and any other data that
changes in the real world or varies by user.

## Project context

- Stack: Next.js 16 App Router, Vercel AI SDK v6, Anthropic Claude
- All financial tools live in `src/lib/tools/` as TypeScript modules
- Tools return structured JSON — never pre-formatted recommendation strings
- The agent synthesizes tool results; tools are pure calculation primitives
- Profile data lives in `profile.json` at the project root (gitignored)
- See `TECH_DEBT.md` for known shortcuts and their planned replacements
