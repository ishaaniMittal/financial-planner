from agent.skills.cash_flow.tools import (
    get_contribution_limits,
    check_contribution_pace,
    calculate_tax_bracket,
    detect_idle_cash,
    suggest_rebalancing,
)

SKILL_NAME = "cash_flow"
SKILL_DESCRIPTION = "Manages cash flow allocation across tax-free, tax-deferred, taxable, and cash accounts. Tracks IRS contribution limits, detects idle cash, and recommends rebalancing."

TOOLS = [
    get_contribution_limits,
    check_contribution_pace,
    calculate_tax_bracket,
    detect_idle_cash,
    suggest_rebalancing,
]
