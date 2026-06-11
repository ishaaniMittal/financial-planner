from agent.skills.asset_location.tools import (
    optimize_asset_location,
    calculate_tax_drag,
    get_placement_rules,
    analyze_holdings,
)

SKILL_NAME = "asset_location"
SKILL_DESCRIPTION = "Determines optimal placement of asset classes across accounts based on tax efficiency. Minimizes tax drag by placing tax-inefficient assets in sheltered accounts."

TOOLS = [
    optimize_asset_location,
    calculate_tax_drag,
    get_placement_rules,
    analyze_holdings,
]
