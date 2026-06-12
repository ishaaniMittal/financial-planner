# Financial Planner

An AI-powered personal finance advisor built with Next.js 16, the Vercel AI SDK, and Claude. It analyzes your accounts, tracks contribution pace, optimizes asset location, and answers questions about your finances in a streaming chat interface.

## Features

- **Streaming chat advisor** — ask questions in natural language; the agent calls tools and streams answers token-by-token
- **Contribution tracking** — checks whether each tax-advantaged account (401k, IRA, HSA, etc.) is on pace to max out by year-end
- **Asset location optimization** — recommends which assets belong in taxable vs. tax-deferred vs. tax-free accounts
- **Idle cash detection** — finds cash beyond your emergency fund target and suggests deployment priority
- **Tax bracket analysis** — calculates marginal/effective rates and Roth vs. Traditional guidance
- **Rebalancing recommendations** — flags allocation drift and generates a monthly action plan
- **Dynamic visualizations** — agent generates Vega-Lite charts inline in chat (bar, donut, heatmap, trend, waterfall, etc.)
- **Saved reports** — pin charts from chat to a persistent report dashboard

## Stack

- [Next.js 16](https://nextjs.org/) — App Router, API routes, server-side file I/O
- [Vercel AI SDK v6](https://sdk.vercel.ai/) — `useChat`, `streamText`, tool calling
- [Anthropic Claude](https://www.anthropic.com/) — `claude-sonnet-4-6` model
- [Vega-Lite](https://vega.github.io/vega-lite/) — declarative chart rendering
- [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) — styling

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

Create `.env.local` in the project root:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Configure your financial profile

Edit `data/profile.json` with your accounts, balances, YTD contributions, and tax info. The schema includes:

- `accounts` — list of accounts with balance, tax treatment, annual limit, YTD contribution, and target allocation
- `tax` — filing status, state, estimated AGI, capital gains rate
- `target_emergency_fund` — cash reserve target
- `current_month` — month number (1–12) for pace calculations

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project structure

```
app/
  api/
    chat/route.ts       # Streaming chat endpoint (tool calling)
    profile/route.ts    # Profile read/write
    reports/route.ts    # Saved reports CRUD
  layout.tsx
  page.tsx              # Tab navigation: Overview / Reports / Advisor
src/
  components/           # React components (all 'use client')
  lib/
    profile.ts          # TypeScript types + profile loader
    prompts.ts          # System prompt
    tools/
      cash-flow.ts      # Contribution, tax bracket, idle cash tools
      asset-location.ts # Placement rules, tax drag, holdings analysis
      visualization.ts  # Vega-Lite chart generation + report saving
data/
  profile.json          # Your financial data (not committed)
  reports.json          # Saved report specs (auto-created)
```
