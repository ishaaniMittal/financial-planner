"""
Cash Flow Skill — Tools for managing money allocation across accounts.

Handles IRS contribution limits, tax bracket calculations, idle cash detection,
and rebalancing recommendations.
"""

from strands import tool
from agent.profile import (
    FinancialProfile,
    AccountTaxTreatment,
    create_sample_profile,
)

# ─── Shared profile access ─────────────────────────────────────────────────────

def _load_profile() -> FinancialProfile:
    return FinancialProfile.load("profile.json")


# ─── Tax Brackets (2025) ───────────────────────────────────────────────────────

FEDERAL_BRACKETS_SINGLE_2025 = [
    (11925, 0.10),
    (48475, 0.12),
    (103350, 0.22),
    (197300, 0.24),
    (250525, 0.32),
    (626350, 0.35),
    (float("inf"), 0.37),
]

FEDERAL_BRACKETS_MFJ_2025 = [
    (23850, 0.10),
    (96950, 0.12),
    (206700, 0.22),
    (394600, 0.24),
    (501050, 0.32),
    (751600, 0.35),
    (float("inf"), 0.37),
]

STATE_RATES = {
    "CA": 0.093,
    "NY": 0.0685,
    "TX": 0.0,
    "WA": 0.0,
    "FL": 0.0,
    "IL": 0.0495,
    "MA": 0.05,
    "NJ": 0.0675,
    "CO": 0.044,
}


# ─── Tools ─────────────────────────────────────────────────────────────────────

@tool
def get_contribution_limits(year: int = 2025) -> str:
    """Get IRS contribution limits for all account types for a given tax year.
    Shows the annual maximum allowed contribution for each account type,
    along with the user's current YTD contributions and remaining capacity.

    Args:
        year: The tax year to look up limits for. Defaults to 2025.
    """
    profile = _load_profile()

    limits_info = []
    limits_info.append(f"=== IRS Contribution Limits ({year}) ===\n")

    # Standard limits reference
    limits_info.append("Standard Limits:")
    limits_info.append(f"  401(k) / 403(b) / 457(b): $23,500")
    limits_info.append(f"  IRA (Traditional + Roth combined): $7,000")
    limits_info.append(f"  HSA (individual): $4,300 | HSA (family): $8,550")
    limits_info.append(f"  ESPP: $25,000 (fair market value)")
    limits_info.append(f"  Catch-up (age 50+): +$7,500 for 401k, +$1,000 for IRA")
    limits_info.append("")

    # User's accounts with limits
    limits_info.append("Your Account Status:")
    limits_info.append(f"{'Account':<22} {'Limit':>10} {'YTD':>10} {'Remaining':>10} {'Pace':>8}")
    limits_info.append("-" * 65)

    expected_pct = profile.current_month / 12
    total_remaining = 0

    for account in profile.accounts:
        if account.annual_contribution_limit is not None:
            remaining = account.annual_contribution_limit - account.ytd_contribution
            total_remaining += remaining
            pct_used = account.ytd_contribution / account.annual_contribution_limit
            pace = "✓ On" if pct_used >= expected_pct - 0.05 else "⚠ Behind"
            if pct_used >= 1.0:
                pace = "★ Maxed"

            limits_info.append(
                f"  {account.name:<20} "
                f"${account.annual_contribution_limit:>8,.0f} "
                f"${account.ytd_contribution:>8,.0f} "
                f"${remaining:>8,.0f} "
                f"{pace:>8}"
            )

    limits_info.append("-" * 65)
    limits_info.append(f"  Total remaining tax-advantaged space: ${total_remaining:,.0f}")
    limits_info.append(f"  Months remaining in year: {12 - profile.current_month}")
    if 12 - profile.current_month > 0:
        limits_info.append(
            f"  Required monthly rate to max all: ${total_remaining / (12 - profile.current_month):,.0f}/mo"
        )

    return "\n".join(limits_info)


@tool
def check_contribution_pace() -> str:
    """Check whether contributions to each account are on pace to max out
    by year-end. Flags accounts that are behind schedule and calculates
    the monthly increase needed to catch up.
    """
    profile = _load_profile()
    expected_pct = profile.current_month / 12
    months_left = 12 - profile.current_month

    results = []
    results.append(f"=== Contribution Pace Check (Month {profile.current_month}/12) ===\n")
    results.append(f"Expected pace: {expected_pct:.0%} of annual limits used\n")

    behind_accounts = []
    on_track_accounts = []
    maxed_accounts = []

    for account in profile.accounts:
        if account.annual_contribution_limit is None:
            continue

        actual_pct = account.ytd_contribution / account.annual_contribution_limit
        remaining = account.annual_contribution_limit - account.ytd_contribution

        if actual_pct >= 1.0:
            maxed_accounts.append(f"  ★ {account.name}: MAXED (${account.annual_contribution_limit:,.0f})")
        elif actual_pct >= expected_pct - 0.05:
            on_track_accounts.append(f"  ✓ {account.name}: {actual_pct:.0%} used (${remaining:,.0f} remaining)")
        else:
            deficit = (expected_pct * account.annual_contribution_limit) - account.ytd_contribution
            monthly_needed = remaining / months_left if months_left > 0 else remaining
            behind_accounts.append(
                f"  ⚠ {account.name}: {actual_pct:.0%} used — "
                f"${deficit:,.0f} behind pace — "
                f"need ${monthly_needed:,.0f}/mo to max out"
            )

    if maxed_accounts:
        results.append("Maxed Out:")
        results.extend(maxed_accounts)
        results.append("")

    if on_track_accounts:
        results.append("On Track:")
        results.extend(on_track_accounts)
        results.append("")

    if behind_accounts:
        results.append("⚠ Behind Pace:")
        results.extend(behind_accounts)
        results.append("")
        results.append("Action: Increase contributions to behind accounts before adding to taxable.")

    if not behind_accounts:
        results.append("All accounts with limits are on track or maxed. Great job!")

    return "\n".join(results)


@tool
def calculate_tax_bracket(additional_income: float = 0) -> str:
    """Calculate the user's current federal and state tax brackets, including
    the impact of additional income. Useful for deciding between Roth (post-tax)
    and Traditional (pre-tax) contributions.

    Args:
        additional_income: Optional additional income to see marginal impact. Defaults to 0.
    """
    profile = _load_profile()
    tax = profile.tax
    agi = tax.estimated_agi + additional_income

    # Determine brackets based on filing status
    if tax.filing_status.value in ("married_filing_jointly",):
        brackets = FEDERAL_BRACKETS_MFJ_2025
    else:
        brackets = FEDERAL_BRACKETS_SINGLE_2025

    # Calculate federal tax
    federal_tax = 0.0
    prev_limit = 0
    current_bracket_rate = 0.0
    for limit, rate in brackets:
        if agi <= limit:
            federal_tax += (agi - prev_limit) * rate
            current_bracket_rate = rate
            break
        else:
            federal_tax += (limit - prev_limit) * rate
            prev_limit = limit
            current_bracket_rate = rate

    state_rate = STATE_RATES.get(tax.state, 0.05)
    state_tax = agi * state_rate  # simplified

    effective_federal_rate = federal_tax / agi if agi > 0 else 0

    results = []
    results.append(f"=== Tax Bracket Analysis ===\n")
    results.append(f"Filing Status: {tax.filing_status.value.replace('_', ' ').title()}")
    results.append(f"State: {tax.state}")
    results.append(f"Estimated AGI: ${agi:,.0f}")
    if additional_income > 0:
        results.append(f"  (includes ${additional_income:,.0f} additional income)")
    results.append("")
    results.append(f"Federal Marginal Rate: {current_bracket_rate:.1%}")
    results.append(f"Federal Effective Rate: {effective_federal_rate:.1%}")
    results.append(f"State Marginal Rate: {state_rate:.1%}")
    results.append(f"Combined Marginal Rate: {current_bracket_rate + state_rate:.1%}")
    results.append(f"Long-Term Cap Gains Rate: {tax.long_term_cap_gains_rate:.1%}")
    results.append(f"NIIT (3.8%): {'Applies' if agi > 200000 else 'Does not apply'}")
    results.append("")

    # Roth vs Traditional guidance
    combined_rate = current_bracket_rate + state_rate
    results.append("─── Roth vs. Traditional Guidance ───")
    if combined_rate >= 0.35:
        results.append("  At your high marginal rate (35%+), Traditional contributions")
        results.append("  provide significant tax savings NOW. Consider Traditional 401(k)")
        results.append("  unless you expect higher income in retirement.")
    elif combined_rate >= 0.25:
        results.append("  Moderate bracket — a mix of Roth and Traditional is optimal.")
        results.append("  Fill Roth IRA + HSA first, then split 401(k) Roth/Traditional.")
    else:
        results.append("  Lower bracket — Roth contributions are favored. Pay tax now at")
        results.append("  the lower rate for tax-free growth and withdrawals.")

    return "\n".join(results)


@tool
def detect_idle_cash() -> str:
    """Analyze cash holdings to detect money sitting idle beyond the
    emergency fund target. Calculates opportunity cost and suggests
    where excess cash should be deployed.
    """
    profile = _load_profile()

    total_cash = profile.total_cash
    target = profile.target_emergency_fund
    excess = profile.excess_cash

    results = []
    results.append("=== Idle Cash Detection ===\n")
    results.append(f"Total Cash Holdings: ${total_cash:,.0f}")
    results.append(f"Emergency Fund Target: ${target:,.0f}")
    results.append(f"Excess Cash: ${excess:,.0f}")
    results.append("")

    # Breakdown by account
    results.append("Cash Account Breakdown:")
    cash_accounts = [a for a in profile.accounts if a.tax_treatment == AccountTaxTreatment.CASH]
    for acc in cash_accounts:
        results.append(f"  {acc.name}: ${acc.balance:,.0f}")
    results.append("")

    if excess <= 0:
        results.append("✓ Cash position is appropriate. No idle money detected.")
        return "\n".join(results)

    # Calculate opportunity cost
    # Assume 7% equity returns vs 4.5% HYSA
    annual_opportunity_cost = excess * (0.07 - 0.045)
    results.append(f"⚠ ${excess:,.0f} is sitting idle beyond your emergency fund.")
    results.append(f"  Estimated annual opportunity cost: ${annual_opportunity_cost:,.0f}")
    results.append(f"  (assuming 7% market return vs 4.5% HYSA rate)")
    results.append("")

    # Suggest deployment
    results.append("Recommended deployment priority:")
    priority_order = [
        (AccountTaxTreatment.TAX_FREE, "Tax-Free (highest efficiency)"),
        (AccountTaxTreatment.TAX_DEFERRED, "Tax-Deferred"),
        (AccountTaxTreatment.TAXABLE, "Taxable (lowest priority)"),
    ]

    remaining = excess
    for treatment, label in priority_order:
        if remaining <= 0:
            break
        accounts = [
            a for a in profile.accounts
            if a.tax_treatment == treatment
            and a.annual_contribution_limit is not None
            and a.ytd_contribution < a.annual_contribution_limit
        ]
        for acc in accounts:
            if remaining <= 0:
                break
            capacity = acc.annual_contribution_limit - acc.ytd_contribution
            deploy = min(remaining, capacity)
            if deploy > 0:
                results.append(f"  → ${deploy:,.0f} → {acc.name} ({label})")
                remaining -= deploy

    if remaining > 0:
        results.append(f"  → ${remaining:,.0f} → Brokerage (all tax-advantaged space filled)")

    return "\n".join(results)


@tool
def suggest_rebalancing() -> str:
    """Generate specific rebalancing recommendations based on target allocation
    percentages vs actual allocations, contribution pace, and idle cash.
    Prioritizes actions by tax efficiency and impact.
    """
    profile = _load_profile()

    results = []
    results.append("=== Rebalancing Recommendations ===\n")

    recommendations = []

    # 1. Check allocation drift
    results.append("─── Allocation Drift ───")
    for account in profile.accounts:
        actual_pct = (account.balance / profile.total_balance) * 100 if profile.total_balance > 0 else 0
        target_pct = account.target_allocation_pct
        drift = actual_pct - target_pct

        if abs(drift) > 2.0:
            direction = "OVER" if drift > 0 else "UNDER"
            dollar_drift = abs(drift / 100 * profile.total_balance)
            recommendations.append({
                "priority": 1 if abs(drift) > 5 else 2,
                "type": "drift",
                "message": f"  {direction}-allocated: {account.name} ({actual_pct:.1f}% vs {target_pct:.1f}% target, ${dollar_drift:,.0f} drift)",
            })

    # 2. Idle cash deployment
    if profile.excess_cash > 500:
        recommendations.append({
            "priority": 1,
            "type": "cash",
            "message": f"  DEPLOY: ${profile.excess_cash:,.0f} excess cash beyond emergency fund",
        })

    # 3. Behind-pace accounts
    expected_pct = profile.current_month / 12
    months_left = 12 - profile.current_month
    for account in profile.accounts:
        if account.annual_contribution_limit is None:
            continue
        actual_pct = account.ytd_contribution / account.annual_contribution_limit
        if actual_pct < expected_pct - 0.1:
            remaining = account.annual_contribution_limit - account.ytd_contribution
            monthly_needed = remaining / months_left if months_left > 0 else remaining
            recommendations.append({
                "priority": 1,
                "type": "pace",
                "message": f"  INCREASE: {account.name} needs ${monthly_needed:,.0f}/mo to max by year-end",
            })

    # Sort and display
    recommendations.sort(key=lambda x: x["priority"])

    if not recommendations:
        results.append("  ✓ All allocations within 2% of target. No rebalancing needed.")
    else:
        results.append(f"  Found {len(recommendations)} action items:\n")
        for rec in recommendations:
            priority_label = "HIGH" if rec["priority"] == 1 else "MEDIUM"
            results.append(f"  [{priority_label}] {rec['message'].strip()}")

    results.append("")
    results.append("─── Monthly Action Plan ───")

    # Build concrete action plan
    if months_left > 0 and profile.excess_cash > 0:
        results.append(f"  Step 1: Move ${min(profile.excess_cash, 2150):,.0f} excess cash → HSA (if capacity remains)")
        results.append(f"  Step 2: Increase 401(k) deferral to max by December")
        results.append(f"  Step 3: Invest remainder in brokerage (tax-efficient funds)")
    elif months_left > 0:
        results.append(f"  Continue current contribution rates — you're on track.")
    else:
        results.append(f"  Year-end: Review and set up auto-increases for next year.")

    return "\n".join(results)
