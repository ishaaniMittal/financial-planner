# Financial Planner — Setup Guide

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  React App (localhost:5173)                          │
│  - Cash flow visualization (Sankey, charts, tables) │
│  - Chat panel → talks to agent API                  │
└────────────────────┬────────────────────────────────┘
                     │ HTTP
┌────────────────────▼────────────────────────────────┐
│  FastAPI Server (localhost:8000)                     │
│  POST /api/chat — send message to agent             │
│  GET  /api/profile — read financial profile         │
│  PUT  /api/profile — update profile                 │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│  Strands Agent                                      │
│  Skills: cash_flow, asset_location                  │
│  Profile: profile.json (shared state)               │
└─────────────────────────────────────────────────────┘
```

## Prerequisites

- Python 3.11+
- Node.js 18+
- AWS Bedrock API key (or Anthropic/OpenAI key)

## Quick Start

### 1. Set up the Agent (Python)

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -e .

# Configure your LLM provider (choose one):

# Option A: AWS Bedrock (default)
export AWS_BEDROCK_API_KEY=your_key_here

# Option B: Anthropic
pip install 'strands-agents[anthropic]'
export ANTHROPIC_API_KEY=your_key_here

# Option C: OpenAI
pip install 'strands-agents[openai]'
export OPENAI_API_KEY=your_key_here
```

### 2. Start the Agent API

```bash
uvicorn agent.server:app --reload --port 8000
```

### 3. Start the React Frontend

```bash
npm install --registry https://registry.npmjs.org/
npm run dev
```

### 4. Open the App

Visit http://localhost:5173 — you'll see the dashboard with a chat panel
connected to the agent.

## CLI Mode (no frontend needed)

```bash
python -m agent.main
```

This gives you an interactive terminal chat with the agent.

## Customizing Your Profile

Edit `profile.json` directly or use the API:

```bash
# Get current profile
curl http://localhost:8000/api/profile | python -m json.tool

# Update profile
curl -X PUT http://localhost:8000/api/profile \
  -H "Content-Type: application/json" \
  -d '{"total_annual_investable": 180000}'
```

## Adding New Skills

1. Create `agent/skills/your_skill/__init__.py`
2. Create `agent/skills/your_skill/tools.py` with `@tool` decorated functions
3. Export `TOOLS` list from `__init__.py`
4. Import and add to `agent/main.py`'s `all_tools` list

Example skill ideas:
- `insurance` — coverage gap analysis, premium comparison
- `tax_loss_harvesting` — identify harvest opportunities, wash sale tracking
- `estate_planning` — beneficiary review, document checklist
- `debt_optimization` — payoff strategies, refinance analysis

## Available Agent Tools

### Cash Flow Skill
| Tool | Purpose |
|------|---------|
| `get_contribution_limits` | IRS limits and YTD progress for all accounts |
| `check_contribution_pace` | Are you on track to max accounts by year-end? |
| `calculate_tax_bracket` | Federal + state marginal rates, Roth vs Trad guidance |
| `detect_idle_cash` | Find excess cash beyond emergency fund |
| `suggest_rebalancing` | Priority-ranked actions to improve allocation |

### Asset Location Skill
| Tool | Purpose |
|------|---------|
| `get_placement_rules` | Which assets belong in which account types |
| `optimize_asset_location` | Find misplaced holdings and suggest moves |
| `calculate_tax_drag` | Annual $ cost of suboptimal placement |
| `analyze_holdings` | Concentration risk and diversification gaps |
