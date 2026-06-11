"""
Visualization Skill — Produces Vega-Lite specs for dynamic, agent-driven charts.

The agent calls `visualize` when a visual representation would best answer the user's
question. The spec is returned as JSON, the frontend detects it and renders inline.
"""

import json
from strands import tool
from agent.profile import FinancialProfile, AccountTaxTreatment


def _load_profile() -> FinancialProfile:
    return FinancialProfile.load("profile.json")


@tool
def visualize(
    chart_type: str,
    title: str,
    description: str,
) -> str:
    """Create a visualization to display financial data to the user.
    Choose the most effective chart type for the data being communicated.
    The visualization will be rendered inline in the chat.

    IMPORTANT: Return value will contain a JSON block delimited by
    ```vega-lite ... ``` that the frontend will detect and render.

    Args:
        chart_type: The type of chart to create. Options:
            - "allocation_bar": Horizontal bar showing account allocations by category
            - "contribution_progress": Progress bars showing YTD vs limits
            - "monthly_trend": Line/area chart of monthly allocation trends
            - "asset_location_heatmap": Heatmap of asset classes vs account types
            - "tax_efficiency_donut": Donut chart of tax efficiency breakdown
            - "account_breakdown_treemap": Treemap of all accounts nested by category
            - "drift_bar": Bar chart showing target vs actual allocation drift
            - "holdings_pie": Pie chart of holdings by asset class
            - "cash_flow_waterfall": Waterfall chart showing income to accounts flow
        title: A descriptive title for the chart.
        description: Brief explanation of what the chart shows and why it's relevant.
    """
    profile = _load_profile()
    spec = _build_spec(chart_type, title, profile)

    # Return the spec wrapped in a fenced block the frontend can detect
    result = f"{description}\n\n```vega-lite\n{json.dumps(spec, indent=2)}\n```"
    return result


def _build_spec(chart_type: str, title: str, profile: FinancialProfile) -> dict:
    """Build a Vega-Lite spec based on chart type and current profile data."""

    if chart_type == "allocation_bar":
        return _allocation_bar(title, profile)
    elif chart_type == "contribution_progress":
        return _contribution_progress(title, profile)
    elif chart_type == "monthly_trend":
        return _monthly_trend(title, profile)
    elif chart_type == "asset_location_heatmap":
        return _asset_location_heatmap(title, profile)
    elif chart_type == "tax_efficiency_donut":
        return _tax_efficiency_donut(title, profile)
    elif chart_type == "account_breakdown_treemap":
        return _account_breakdown_treemap(title, profile)
    elif chart_type == "drift_bar":
        return _drift_bar(title, profile)
    elif chart_type == "holdings_pie":
        return _holdings_pie(title, profile)
    elif chart_type == "cash_flow_waterfall":
        return _cash_flow_waterfall(title, profile)
    else:
        # Fallback: simple bar of account balances
        return _allocation_bar(title, profile)


def _allocation_bar(title: str, profile: FinancialProfile) -> dict:
    """Horizontal bar chart of allocations by category."""
    data = []
    category_labels = {
        AccountTaxTreatment.TAX_FREE: "Tax-Free",
        AccountTaxTreatment.TAX_DEFERRED: "Tax-Deferred",
        AccountTaxTreatment.TAXABLE: "Taxable",
        AccountTaxTreatment.CASH: "Cash",
    }
    category_colors = {
        "Tax-Free": "#10b981",
        "Tax-Deferred": "#3b82f6",
        "Taxable": "#f59e0b",
        "Cash": "#8b5cf6",
    }

    for account in profile.accounts:
        cat = category_labels.get(account.tax_treatment, "Other")
        data.append({
            "account": account.name,
            "category": cat,
            "value": account.balance,
        })

    return {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "title": title,
        "width": 500,
        "height": 300,
        "data": {"values": data},
        "mark": {"type": "bar", "cornerRadiusEnd": 4},
        "encoding": {
            "y": {"field": "account", "type": "nominal", "sort": "-x", "title": None},
            "x": {"field": "value", "type": "quantitative", "title": "Balance ($)"},
            "color": {
                "field": "category",
                "type": "nominal",
                "scale": {
                    "domain": list(category_colors.keys()),
                    "range": list(category_colors.values()),
                },
                "title": "Account Type",
            },
            "tooltip": [
                {"field": "account", "type": "nominal", "title": "Account"},
                {"field": "category", "type": "nominal", "title": "Type"},
                {"field": "value", "type": "quantitative", "title": "Balance", "format": "$,.0f"},
            ],
        },
    }


def _contribution_progress(title: str, profile: FinancialProfile) -> dict:
    """Grouped bar showing YTD contribution vs annual limit."""
    data = []
    for account in profile.accounts:
        if account.annual_contribution_limit is not None:
            data.append({
                "account": account.name,
                "measure": "YTD Contributed",
                "value": account.ytd_contribution,
            })
            data.append({
                "account": account.name,
                "measure": "Annual Limit",
                "value": account.annual_contribution_limit,
            })

    return {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "title": title,
        "width": 500,
        "height": 250,
        "data": {"values": data},
        "mark": {"type": "bar", "cornerRadiusEnd": 3},
        "encoding": {
            "y": {"field": "account", "type": "nominal", "title": None},
            "x": {"field": "value", "type": "quantitative", "title": "Amount ($)"},
            "color": {
                "field": "measure",
                "type": "nominal",
                "scale": {
                    "domain": ["YTD Contributed", "Annual Limit"],
                    "range": ["#10b981", "#e2e8f0"],
                },
            },
            "xOffset": {"field": "measure"},
            "tooltip": [
                {"field": "account", "type": "nominal"},
                {"field": "measure", "type": "nominal"},
                {"field": "value", "type": "quantitative", "format": "$,.0f"},
            ],
        },
    }


def _monthly_trend(title: str, profile: FinancialProfile) -> dict:
    """Stacked area chart of monthly contributions by category."""
    data = []
    for snap in profile.monthly_history:
        data.append({"month": snap.month, "category": "Tax-Free", "value": snap.tax_free})
        data.append({"month": snap.month, "category": "Tax-Deferred", "value": snap.tax_deferred})
        data.append({"month": snap.month, "category": "Taxable", "value": snap.taxable})
        data.append({"month": snap.month, "category": "Cash", "value": snap.cash})

    return {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "title": title,
        "width": 500,
        "height": 280,
        "data": {"values": data},
        "mark": {"type": "area", "interpolate": "monotone"},
        "encoding": {
            "x": {"field": "month", "type": "ordinal", "title": "Month"},
            "y": {"field": "value", "type": "quantitative", "stack": "zero", "title": "Monthly Contribution ($)"},
            "color": {
                "field": "category",
                "type": "nominal",
                "scale": {
                    "domain": ["Tax-Free", "Tax-Deferred", "Taxable", "Cash"],
                    "range": ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6"],
                },
            },
            "tooltip": [
                {"field": "month", "type": "ordinal"},
                {"field": "category", "type": "nominal"},
                {"field": "value", "type": "quantitative", "format": "$,.0f"},
            ],
        },
    }


def _asset_location_heatmap(title: str, profile: FinancialProfile) -> dict:
    """Heatmap showing asset class placement across account types."""
    data = []
    account_type_labels = {
        AccountTaxTreatment.TAX_FREE: "Tax-Free",
        AccountTaxTreatment.TAX_DEFERRED: "Tax-Deferred",
        AccountTaxTreatment.TAXABLE: "Taxable",
    }

    for account in profile.accounts:
        if account.tax_treatment == AccountTaxTreatment.CASH:
            continue
        acc_type = account_type_labels.get(account.tax_treatment, "Other")
        for holding in account.holdings:
            est_value = holding.shares * (holding.cost_basis_per_share if holding.cost_basis_per_share > 0 else 100)
            data.append({
                "account_type": acc_type,
                "asset_class": holding.asset_class.value.replace("_", " ").title(),
                "value": est_value,
            })

    # Aggregate duplicates
    aggregated: dict[tuple[str, str], float] = {}
    for d in data:
        key = (d["account_type"], d["asset_class"])
        aggregated[key] = aggregated.get(key, 0) + d["value"]

    agg_data = [
        {"account_type": k[0], "asset_class": k[1], "value": v}
        for k, v in aggregated.items()
    ]

    return {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "title": title,
        "width": 400,
        "height": 250,
        "data": {"values": agg_data},
        "mark": {"type": "rect", "cornerRadius": 4},
        "encoding": {
            "x": {"field": "account_type", "type": "nominal", "title": "Account Type"},
            "y": {"field": "asset_class", "type": "nominal", "title": "Asset Class"},
            "color": {
                "field": "value",
                "type": "quantitative",
                "title": "Value ($)",
                "scale": {"scheme": "blues"},
            },
            "tooltip": [
                {"field": "account_type", "type": "nominal"},
                {"field": "asset_class", "type": "nominal"},
                {"field": "value", "type": "quantitative", "format": "$,.0f"},
            ],
        },
    }


def _tax_efficiency_donut(title: str, profile: FinancialProfile) -> dict:
    """Donut chart showing allocation by tax treatment."""
    category_totals: dict[str, float] = {}
    labels = {
        AccountTaxTreatment.TAX_FREE: "Tax-Free",
        AccountTaxTreatment.TAX_DEFERRED: "Tax-Deferred",
        AccountTaxTreatment.TAXABLE: "Taxable",
        AccountTaxTreatment.CASH: "Cash",
    }

    for account in profile.accounts:
        cat = labels.get(account.tax_treatment, "Other")
        category_totals[cat] = category_totals.get(cat, 0) + account.balance

    data = [{"category": k, "value": v} for k, v in category_totals.items()]

    return {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "title": title,
        "width": 300,
        "height": 300,
        "data": {"values": data},
        "mark": {"type": "arc", "innerRadius": 70, "cornerRadius": 4},
        "encoding": {
            "theta": {"field": "value", "type": "quantitative", "stack": True},
            "color": {
                "field": "category",
                "type": "nominal",
                "scale": {
                    "domain": ["Tax-Free", "Tax-Deferred", "Taxable", "Cash"],
                    "range": ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6"],
                },
            },
            "tooltip": [
                {"field": "category", "type": "nominal"},
                {"field": "value", "type": "quantitative", "format": "$,.0f"},
            ],
        },
    }


def _account_breakdown_treemap(title: str, profile: FinancialProfile) -> dict:
    """Treemap of accounts nested within categories."""
    labels = {
        AccountTaxTreatment.TAX_FREE: "Tax-Free",
        AccountTaxTreatment.TAX_DEFERRED: "Tax-Deferred",
        AccountTaxTreatment.TAXABLE: "Taxable",
        AccountTaxTreatment.CASH: "Cash",
    }

    data = []
    for account in profile.accounts:
        cat = labels.get(account.tax_treatment, "Other")
        data.append({
            "category": cat,
            "account": account.name,
            "value": account.balance,
        })

    # Vega-Lite doesn't natively do treemaps, use a packed bubble as alternative
    return {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "title": title,
        "width": 500,
        "height": 300,
        "data": {"values": data},
        "mark": {"type": "circle", "opacity": 0.8},
        "encoding": {
            "x": {"field": "category", "type": "nominal", "title": None},
            "y": {"field": "value", "type": "quantitative", "title": "Balance ($)"},
            "size": {"field": "value", "type": "quantitative", "legend": None},
            "color": {
                "field": "category",
                "type": "nominal",
                "scale": {
                    "domain": ["Tax-Free", "Tax-Deferred", "Taxable", "Cash"],
                    "range": ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6"],
                },
            },
            "tooltip": [
                {"field": "account", "type": "nominal"},
                {"field": "category", "type": "nominal"},
                {"field": "value", "type": "quantitative", "format": "$,.0f"},
            ],
        },
    }


def _drift_bar(title: str, profile: FinancialProfile) -> dict:
    """Bar chart showing allocation drift (actual - target) per account."""
    data = []
    total = profile.total_balance

    for account in profile.accounts:
        actual_pct = (account.balance / total * 100) if total > 0 else 0
        drift = actual_pct - account.target_allocation_pct
        data.append({
            "account": account.name,
            "drift": round(drift, 2),
            "status": "Over" if drift > 0 else "Under",
        })

    return {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "title": title,
        "width": 500,
        "height": 280,
        "data": {"values": data},
        "mark": {"type": "bar", "cornerRadiusEnd": 3},
        "encoding": {
            "y": {"field": "account", "type": "nominal", "sort": {"field": "drift", "order": "descending"}, "title": None},
            "x": {"field": "drift", "type": "quantitative", "title": "Drift (percentage points)"},
            "color": {
                "field": "status",
                "type": "nominal",
                "scale": {
                    "domain": ["Over", "Under"],
                    "range": ["#f59e0b", "#3b82f6"],
                },
            },
            "tooltip": [
                {"field": "account", "type": "nominal"},
                {"field": "drift", "type": "quantitative", "format": "+.1f"},
            ],
        },
    }


def _holdings_pie(title: str, profile: FinancialProfile) -> dict:
    """Pie chart of portfolio by asset class."""
    class_totals: dict[str, float] = {}

    for account in profile.accounts:
        for holding in account.holdings:
            est_value = holding.shares * (holding.cost_basis_per_share if holding.cost_basis_per_share > 0 else 100)
            label = holding.asset_class.value.replace("_", " ").title()
            class_totals[label] = class_totals.get(label, 0) + est_value

    data = [{"asset_class": k, "value": v} for k, v in class_totals.items()]

    return {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "title": title,
        "width": 320,
        "height": 320,
        "data": {"values": data},
        "mark": {"type": "arc", "cornerRadius": 3},
        "encoding": {
            "theta": {"field": "value", "type": "quantitative", "stack": True},
            "color": {
                "field": "asset_class",
                "type": "nominal",
                "scale": {"scheme": "tableau10"},
                "title": "Asset Class",
            },
            "tooltip": [
                {"field": "asset_class", "type": "nominal"},
                {"field": "value", "type": "quantitative", "format": "$,.0f"},
            ],
        },
    }


def _cash_flow_waterfall(title: str, profile: FinancialProfile) -> dict:
    """Waterfall-style chart showing how total income breaks into accounts."""
    labels = {
        AccountTaxTreatment.TAX_FREE: "Tax-Free",
        AccountTaxTreatment.TAX_DEFERRED: "Tax-Deferred",
        AccountTaxTreatment.TAXABLE: "Taxable",
        AccountTaxTreatment.CASH: "Cash",
    }

    # Aggregate by category for the waterfall
    category_totals: dict[str, float] = {}
    for account in profile.accounts:
        cat = labels.get(account.tax_treatment, "Other")
        # Use the planned annual contribution (value field from original data)
        contrib = account.ytd_contribution * (12 / max(profile.current_month, 1))  # annualize
        category_totals[cat] = category_totals.get(cat, 0) + contrib

    data = []
    running = 0
    for cat in ["Tax-Free", "Tax-Deferred", "Taxable", "Cash"]:
        val = category_totals.get(cat, 0)
        data.append({
            "category": cat,
            "start": running,
            "end": running + val,
            "value": val,
        })
        running += val

    return {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "title": title,
        "width": 450,
        "height": 280,
        "data": {"values": data},
        "mark": {"type": "bar", "cornerRadius": 4},
        "encoding": {
            "x": {"field": "category", "type": "nominal", "title": None,
                   "sort": ["Tax-Free", "Tax-Deferred", "Taxable", "Cash"]},
            "y": {"field": "start", "type": "quantitative", "title": "Annual Allocation ($)"},
            "y2": {"field": "end"},
            "color": {
                "field": "category",
                "type": "nominal",
                "scale": {
                    "domain": ["Tax-Free", "Tax-Deferred", "Taxable", "Cash"],
                    "range": ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6"],
                },
                "legend": None,
            },
            "tooltip": [
                {"field": "category", "type": "nominal"},
                {"field": "value", "type": "quantitative", "format": "$,.0f"},
            ],
        },
    }
