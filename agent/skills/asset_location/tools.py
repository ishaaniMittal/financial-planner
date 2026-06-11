"""
Asset Location Skill — Tools for optimizing WHERE to hold each asset class.

Different from asset allocation (what % in stocks vs bonds), asset location
determines which ACCOUNT each asset goes in to minimize tax drag.

Key principles:
- Tax-inefficient assets (bonds, REITs, high-dividend) → tax-deferred
- Highest-growth assets → Roth (tax-free compounding, no RMDs)
- Tax-efficient assets (index funds, growth stocks) → taxable
- International stocks → taxable (foreign tax credit)
"""

from strands import tool
from agent.profile import (
    FinancialProfile,
    AccountTaxTreatment,
    AssetClass,
    Holding,
    Account,
)


def _load_profile() -> FinancialProfile:
    return FinancialProfile.load("profile.json")


# ─── Placement Rules Knowledge ─────────────────────────────────────────────────

PLACEMENT_RULES: dict[AssetClass, dict] = {
    AssetClass.US_BONDS: {
        "preferred": AccountTaxTreatment.TAX_DEFERRED,
        "acceptable": AccountTaxTreatment.TAX_FREE,
        "avoid": AccountTaxTreatment.TAXABLE,
        "reason": "Bond income taxed as ordinary income. Sheltering in tax-deferred avoids annual tax drag on coupon payments.",
        "tax_drag_factor": 0.85,  # high drag if in wrong account
    },
    AssetClass.INTL_BONDS: {
        "preferred": AccountTaxTreatment.TAX_DEFERRED,
        "acceptable": AccountTaxTreatment.TAXABLE,
        "avoid": None,
        "reason": "Similar to US bonds but can claim foreign tax credit in taxable. Still prefer deferred for simplicity.",
        "tax_drag_factor": 0.75,
    },
    AssetClass.REITS: {
        "preferred": AccountTaxTreatment.TAX_DEFERRED,
        "acceptable": AccountTaxTreatment.TAX_FREE,
        "avoid": AccountTaxTreatment.TAXABLE,
        "reason": "REIT dividends are non-qualified and taxed at ordinary income rates. Never hold in taxable if avoidable.",
        "tax_drag_factor": 0.90,
    },
    AssetClass.US_EQUITY_LARGE: {
        "preferred": AccountTaxTreatment.TAX_FREE,
        "acceptable": AccountTaxTreatment.TAXABLE,
        "avoid": None,
        "reason": "Growth stocks with low dividends are tax-efficient. Roth maximizes tax-free compounding; taxable gets step-up basis and long-term cap gains rates.",
        "tax_drag_factor": 0.20,
    },
    AssetClass.US_EQUITY_SMALL: {
        "preferred": AccountTaxTreatment.TAX_FREE,
        "acceptable": AccountTaxTreatment.TAXABLE,
        "avoid": None,
        "reason": "Higher expected returns make Roth ideal for maximum tax-free growth. Acceptable in taxable with tax-managed funds.",
        "tax_drag_factor": 0.30,
    },
    AssetClass.INTL_EQUITY_DEVELOPED: {
        "preferred": AccountTaxTreatment.TAXABLE,
        "acceptable": AccountTaxTreatment.TAX_FREE,
        "avoid": AccountTaxTreatment.TAX_DEFERRED,
        "reason": "Foreign tax credit only available in taxable accounts. Placing international in tax-deferred wastes the credit.",
        "tax_drag_factor": 0.40,
    },
    AssetClass.INTL_EQUITY_EMERGING: {
        "preferred": AccountTaxTreatment.TAXABLE,
        "acceptable": AccountTaxTreatment.TAX_FREE,
        "avoid": AccountTaxTreatment.TAX_DEFERRED,
        "reason": "Same as developed international — foreign tax credit is valuable. Higher growth potential also benefits from Roth.",
        "tax_drag_factor": 0.45,
    },
    AssetClass.TIPS: {
        "preferred": AccountTaxTreatment.TAX_DEFERRED,
        "acceptable": AccountTaxTreatment.TAX_FREE,
        "avoid": AccountTaxTreatment.TAXABLE,
        "reason": "TIPS generate phantom income (inflation adjustments taxed annually) making them very tax-inefficient in taxable.",
        "tax_drag_factor": 0.80,
    },
    AssetClass.COMMODITIES: {
        "preferred": AccountTaxTreatment.TAX_DEFERRED,
        "acceptable": AccountTaxTreatment.TAX_FREE,
        "avoid": AccountTaxTreatment.TAXABLE,
        "reason": "Commodity funds often generate K-1s with complex tax implications. Simpler in tax-sheltered accounts.",
        "tax_drag_factor": 0.60,
    },
    AssetClass.CRYPTO: {
        "preferred": AccountTaxTreatment.TAX_FREE,
        "acceptable": AccountTaxTreatment.TAXABLE,
        "avoid": None,
        "reason": "High growth potential benefits from Roth. In taxable, every swap is a taxable event; long-term holding mitigates this.",
        "tax_drag_factor": 0.50,
    },
    AssetClass.CASH_EQUIVALENT: {
        "preferred": AccountTaxTreatment.CASH,
        "acceptable": AccountTaxTreatment.TAXABLE,
        "avoid": AccountTaxTreatment.TAX_FREE,
        "reason": "Don't waste tax-advantaged space on cash. Keep in dedicated cash accounts or money market.",
        "tax_drag_factor": 0.10,
    },
}


# ─── Tools ─────────────────────────────────────────────────────────────────────

@tool
def get_placement_rules(asset_class: str = "") -> str:
    """Get the optimal account placement rules for asset classes.
    Explains WHY each asset class should go in specific account types
    to minimize tax drag.

    Args:
        asset_class: Specific asset class to look up (e.g., "us_bonds", "reits", "intl_equity_developed"). Leave empty to see all rules.
    """
    results = []
    results.append("=== Asset Location Placement Rules ===\n")
    results.append("Principle: Place tax-INefficient assets in tax-sheltered accounts.\n")

    if asset_class:
        # Look up specific class
        try:
            ac = AssetClass(asset_class)
        except ValueError:
            return f"Unknown asset class: '{asset_class}'. Valid options: {[a.value for a in AssetClass]}"

        rule = PLACEMENT_RULES.get(ac)
        if not rule:
            return f"No placement rule defined for {asset_class}."

        results.append(f"Asset Class: {ac.value}")
        results.append(f"  Preferred Account: {rule['preferred'].value if rule['preferred'] else 'Any'}")
        results.append(f"  Acceptable: {rule['acceptable'].value if rule['acceptable'] else 'Any'}")
        results.append(f"  Avoid: {rule['avoid'].value if rule['avoid'] else 'None'}")
        results.append(f"  Tax Drag Factor: {rule['tax_drag_factor']:.0%} (higher = more drag if misplaced)")
        results.append(f"  Rationale: {rule['reason']}")
    else:
        # Show all rules
        results.append(f"{'Asset Class':<25} {'Preferred':<15} {'Acceptable':<15} {'Avoid':<15} {'Drag':<6}")
        results.append("-" * 80)
        for ac, rule in PLACEMENT_RULES.items():
            preferred = rule["preferred"].value if rule["preferred"] else "Any"
            acceptable = rule["acceptable"].value if rule["acceptable"] else "Any"
            avoid = rule["avoid"].value if rule["avoid"] else "—"
            results.append(
                f"  {ac.value:<23} {preferred:<15} {acceptable:<15} {avoid:<15} {rule['tax_drag_factor']:.0%}"
            )

        results.append("")
        results.append("Summary Priority Order:")
        results.append("  Tax-Deferred: Bonds, REITs, TIPS, Commodities (income-heavy assets)")
        results.append("  Tax-Free (Roth): US equities, small-cap, crypto (highest growth)")
        results.append("  Taxable: International equities (foreign tax credit), tax-efficient index funds")

    return "\n".join(results)


@tool
def optimize_asset_location() -> str:
    """Analyze current holdings and recommend optimal placement changes.
    Compares where assets ARE vs where they SHOULD BE and suggests
    specific moves to reduce tax drag.
    """
    profile = _load_profile()

    results = []
    results.append("=== Asset Location Optimization ===\n")

    # Catalog current placements
    misplacements = []
    well_placed = []

    for account in profile.accounts:
        if account.tax_treatment == AccountTaxTreatment.CASH:
            continue  # Skip cash accounts

        for holding in account.holdings:
            rule = PLACEMENT_RULES.get(holding.asset_class)
            if not rule:
                continue

            current = account.tax_treatment
            preferred = rule["preferred"]
            avoid = rule["avoid"]

            if current == avoid:
                misplacements.append({
                    "holding": holding,
                    "account": account,
                    "current": current,
                    "preferred": preferred,
                    "severity": "HIGH",
                    "reason": rule["reason"],
                    "drag_factor": rule["tax_drag_factor"],
                })
            elif current != preferred and current != rule["acceptable"]:
                misplacements.append({
                    "holding": holding,
                    "account": account,
                    "current": current,
                    "preferred": preferred,
                    "severity": "MEDIUM",
                    "reason": rule["reason"],
                    "drag_factor": rule["tax_drag_factor"],
                })
            else:
                well_placed.append({
                    "holding": holding,
                    "account": account,
                })

    # Report
    results.append(f"Analyzed {len(well_placed) + len(misplacements)} holdings across {len(profile.accounts) - 3} investment accounts.\n")

    if not misplacements:
        results.append("✓ All holdings are optimally placed! No changes recommended.")
        return "\n".join(results)

    results.append(f"⚠ Found {len(misplacements)} suboptimal placements:\n")

    # Sort by severity and drag factor
    misplacements.sort(key=lambda x: (-x["drag_factor"], x["severity"]))

    for i, mp in enumerate(misplacements, 1):
        h = mp["holding"]
        results.append(f"  {i}. [{mp['severity']}] {h.ticker} ({h.asset_class.value})")
        results.append(f"     Currently in: {mp['account'].name} ({mp['current'].value})")
        results.append(f"     Should be in: {mp['preferred'].value}")
        results.append(f"     Reason: {mp['reason']}")
        results.append("")

    # Concrete suggestions
    results.append("─── Suggested Moves ───")
    results.append("Note: Only make moves that don't trigger taxable events in taxable accounts.\n")

    for mp in misplacements:
        h = mp["holding"]
        if mp["account"].tax_treatment == AccountTaxTreatment.TAXABLE:
            results.append(f"  • {h.ticker}: For NEW purchases, buy in {mp['preferred'].value} accounts instead.")
            results.append(f"    Existing shares: Hold (selling triggers cap gains). Redirect dividends.")
        else:
            results.append(f"  • {h.ticker}: Can exchange within {mp['account'].name} to better-suited fund,")
            results.append(f"    or adjust future contributions to target {mp['preferred'].value} accounts.")

    return "\n".join(results)


@tool
def calculate_tax_drag(ticker: str = "", account_type: str = "") -> str:
    """Calculate the annual tax drag of holding a specific asset in a specific
    account type. Shows the dollar cost of suboptimal placement.

    Args:
        ticker: The ticker symbol to analyze (e.g., "VBTLX", "VTI"). Leave empty to analyze all holdings.
        account_type: Account type to simulate placement in ("tax_free", "tax_deferred", "taxable"). Leave empty to compare all.
    """
    profile = _load_profile()
    tax = profile.tax

    results = []
    results.append("=== Tax Drag Analysis ===\n")

    # Find relevant holdings
    target_holdings: list[tuple[Holding, Account]] = []
    for account in profile.accounts:
        for holding in account.holdings:
            if not ticker or holding.ticker.upper() == ticker.upper():
                target_holdings.append((holding, account))

    if not target_holdings:
        if ticker:
            return f"Ticker '{ticker}' not found in any account."
        return "No holdings found to analyze."

    results.append(f"{'Ticker':<8} {'Account':<22} {'Value':>10} {'Div Yield':>10} {'Tax Drag':>10} {'Optimal?':>8}")
    results.append("-" * 75)

    total_drag = 0.0

    for holding, account in target_holdings:
        # Estimate holding value (simplified: shares × some price)
        # In a real system this would use market data
        est_value = holding.shares * (holding.cost_basis_per_share if holding.cost_basis_per_share > 0 else 100)

        # Calculate annual tax drag based on account type
        annual_dividends = est_value * (holding.dividend_yield / 100)
        annual_cap_gains_from_turnover = est_value * (holding.turnover_rate / 100) * 0.3  # assume 30% of turnover is gain

        if account.tax_treatment == AccountTaxTreatment.TAXABLE:
            # Dividends taxed, realized gains taxed
            dividend_tax = annual_dividends * (tax.marginal_federal_rate + tax.marginal_state_rate) * 0.7  # qualified discount
            gains_tax = annual_cap_gains_from_turnover * tax.long_term_cap_gains_rate
            drag = dividend_tax + gains_tax
        elif account.tax_treatment == AccountTaxTreatment.TAX_DEFERRED:
            # No annual drag, but withdrawals taxed as ordinary income
            # Estimate: drag is deferred, approximate as 0 for annual comparison
            drag = 0.0
        elif account.tax_treatment == AccountTaxTreatment.TAX_FREE:
            # No tax ever
            drag = 0.0
        else:
            drag = annual_dividends * 0.25  # cash accounts: interest taxed

        total_drag += drag

        rule = PLACEMENT_RULES.get(holding.asset_class)
        is_optimal = "✓" if rule and account.tax_treatment in (rule["preferred"], rule["acceptable"]) else "✗"

        results.append(
            f"  {holding.ticker:<6} {account.name:<22} "
            f"${est_value:>8,.0f} "
            f"{holding.dividend_yield:>8.1f}% "
            f"${drag:>8,.0f} "
            f"{is_optimal:>6}"
        )

    results.append("-" * 75)
    results.append(f"  Total estimated annual tax drag: ${total_drag:,.0f}")
    results.append("")
    results.append("  Tax drag = taxes paid annually due to dividends and capital gains")
    results.append("  distributions in taxable accounts. Tax-deferred and tax-free")
    results.append("  accounts have $0 annual drag (deferred has drag at withdrawal).")

    return "\n".join(results)


@tool
def analyze_holdings() -> str:
    """Provide a complete overview of all holdings across all accounts,
    grouped by asset class. Shows concentration risk, diversification gaps,
    and overall portfolio composition.
    """
    profile = _load_profile()

    results = []
    results.append("=== Holdings Analysis ===\n")

    # Group by asset class
    asset_class_totals: dict[AssetClass, dict] = {}
    total_invested = 0.0

    for account in profile.accounts:
        if account.tax_treatment == AccountTaxTreatment.CASH:
            continue
        for holding in account.holdings:
            est_value = holding.shares * (holding.cost_basis_per_share if holding.cost_basis_per_share > 0 else 100)
            total_invested += est_value

            if holding.asset_class not in asset_class_totals:
                asset_class_totals[holding.asset_class] = {"value": 0, "holdings": []}
            asset_class_totals[holding.asset_class]["value"] += est_value
            asset_class_totals[holding.asset_class]["holdings"].append({
                "ticker": holding.ticker,
                "value": est_value,
                "account": account.name,
                "account_type": account.tax_treatment.value,
            })

    # Sort by value
    sorted_classes = sorted(asset_class_totals.items(), key=lambda x: -x[1]["value"])

    results.append(f"Total Invested (excl. cash): ${total_invested:,.0f}\n")
    results.append(f"{'Asset Class':<25} {'Value':>12} {'Allocation':>12} {'# Holdings':>12}")
    results.append("-" * 65)

    for ac, data in sorted_classes:
        pct = (data["value"] / total_invested * 100) if total_invested > 0 else 0
        results.append(f"  {ac.value:<23} ${data['value']:>10,.0f} {pct:>10.1f}% {len(data['holdings']):>10}")

    results.append("-" * 65)
    results.append("")

    # Concentration check
    results.append("─── Concentration Risks ───")
    ticker_totals: dict[str, float] = {}
    for ac_data in asset_class_totals.values():
        for h in ac_data["holdings"]:
            ticker_totals[h["ticker"]] = ticker_totals.get(h["ticker"], 0) + h["value"]

    concentrated = [(t, v) for t, v in ticker_totals.items() if v / total_invested > 0.15]
    if concentrated:
        for ticker, value in sorted(concentrated, key=lambda x: -x[1]):
            pct = value / total_invested * 100
            results.append(f"  ⚠ {ticker}: ${value:,.0f} ({pct:.1f}%) — consider diversifying above 15%")
    else:
        results.append("  ✓ No single holding exceeds 15% of portfolio.")

    # Diversification gaps
    results.append("")
    results.append("─── Diversification Gaps ───")
    common_classes = {AssetClass.US_EQUITY_LARGE, AssetClass.INTL_EQUITY_DEVELOPED, AssetClass.US_BONDS}
    missing = common_classes - set(asset_class_totals.keys())
    if missing:
        for ac in missing:
            results.append(f"  ⚠ Missing: {ac.value} — consider adding for diversification")
    else:
        results.append("  ✓ Core asset classes (US equity, international, bonds) all represented.")

    return "\n".join(results)
